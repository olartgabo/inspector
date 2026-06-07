/**
 * Deploy the echo agent to AWS Bedrock AgentCore Runtime via S3 direct code deploy.
 *
 * Credentials are read from the standard AWS provider chain (environment
 * variables, `aws configure`, SSO, or an IAM role) — this script never reads
 * any key file. Set AWS_REGION (default us-east-1) and run:
 *
 *     npm install      # once, to get the deploy dependencies
 *     npm run deploy
 *
 * It is idempotent: existing bucket/role are reused. On success it prints the
 * runtime ARN to use as AGENTCORE_RUNTIME_ARN.
 */

import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  IAMClient,
  GetRoleCommand,
  CreateRoleCommand,
  PutRolePolicyCommand,
} from "@aws-sdk/client-iam";
import {
  BedrockAgentCoreControlClient,
  CreateAgentRuntimeCommand,
  GetAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const AGENT_NAME = process.env.AGENT_NAME ?? "echo_agent"; // letters/digits/underscore
const ROLE_NAME = `AmazonBedrockAgentCoreSDKRuntime-${REGION}`;
const S3_PREFIX = `${AGENT_NAME}/deployment_package.zip`;
const DIR = path.dirname(fileURLToPath(import.meta.url));

const sts = new STSClient({ region: REGION });
const s3 = new S3Client({ region: REGION });
const iam = new IAMClient({ region: REGION });
const control = new BedrockAgentCoreControlClient({ region: REGION });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...args) => console.log("[deploy]", ...args);

// --- IAM policy documents (AWS "direct deploy execution role") -----------

function trustPolicy(accountId) {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AssumeRolePolicy",
        Effect: "Allow",
        Principal: { Service: "bedrock-agentcore.amazonaws.com" },
        Action: "sts:AssumeRole",
        Condition: {
          StringEquals: { "aws:SourceAccount": accountId },
          ArnLike: {
            "aws:SourceArn": `arn:aws:bedrock-agentcore:${REGION}:${accountId}:*`,
          },
        },
      },
    ],
  });
}

function executionPolicy(accountId) {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["logs:DescribeLogStreams", "logs:CreateLogGroup"],
        Resource: [
          `arn:aws:logs:${REGION}:${accountId}:log-group:/aws/bedrock-agentcore/runtimes/*`,
        ],
      },
      {
        Effect: "Allow",
        Action: ["logs:DescribeLogGroups"],
        Resource: [`arn:aws:logs:${REGION}:${accountId}:log-group:*`],
      },
      {
        Effect: "Allow",
        Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
        Resource: [
          `arn:aws:logs:${REGION}:${accountId}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`,
        ],
      },
      {
        Effect: "Allow",
        Action: [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets",
        ],
        Resource: ["*"],
      },
      {
        Effect: "Allow",
        Action: "cloudwatch:PutMetricData",
        Resource: "*",
        Condition: {
          StringEquals: { "cloudwatch:namespace": "bedrock-agentcore" },
        },
      },
    ],
  });
}

// --- Steps ---------------------------------------------------------------

async function ensureBucket(bucket) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    log(`bucket exists: ${bucket}`);
    return;
  } catch {
    // Fall through to create.
  }
  // us-east-1 must NOT be given a LocationConstraint.
  const input =
    REGION === "us-east-1"
      ? { Bucket: bucket }
      : {
          Bucket: bucket,
          CreateBucketConfiguration: { LocationConstraint: REGION },
        };
  await s3.send(new CreateBucketCommand(input));
  log(`created bucket: ${bucket}`);
}

function buildZip() {
  // Build a clean, production-only dependency tree so the zip contains just the
  // agent + express (not the deploy-time AWS SDK / adm-zip dev deps).
  const buildDir = path.join(DIR, ".deploy-build");
  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });
  cpSync(path.join(DIR, "app.js"), path.join(buildDir, "app.js"));
  cpSync(path.join(DIR, "package.json"), path.join(buildDir, "package.json"));
  log("installing production dependencies for the bundle...");
  execSync("npm install --omit=dev --no-package-lock --no-audit --no-fund", {
    cwd: buildDir,
    stdio: "inherit",
  });

  const zip = new AdmZip();
  zip.addLocalFile(path.join(buildDir, "app.js"));
  zip.addLocalFile(path.join(buildDir, "package.json"));
  zip.addLocalFolder(path.join(buildDir, "node_modules"), "node_modules");
  const buffer = zip.toBuffer();
  log(`built zip (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
  return buffer;
}

async function ensureRole(accountId) {
  const arn = `arn:aws:iam::${accountId}:role/${ROLE_NAME}`;
  try {
    await iam.send(new GetRoleCommand({ RoleName: ROLE_NAME }));
    log(`role exists: ${ROLE_NAME}`);
    return arn;
  } catch {
    // Create below.
  }
  await iam.send(
    new CreateRoleCommand({
      RoleName: ROLE_NAME,
      AssumeRolePolicyDocument: trustPolicy(accountId),
      Description: "Execution role for AgentCore echo-agent test runtime.",
    })
  );
  await iam.send(
    new PutRolePolicyCommand({
      RoleName: ROLE_NAME,
      PolicyName: "AgentCoreRuntimeExecution",
      PolicyDocument: executionPolicy(accountId),
    })
  );
  log(`created role: ${ROLE_NAME} (waiting for IAM propagation...)`);
  await sleep(12000); // IAM is eventually consistent before the service can assume it.
  return arn;
}

async function createRuntime(bucket, roleArn) {
  // Retry briefly: a freshly-created role may not yet be assumable.
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await control.send(
        new CreateAgentRuntimeCommand({
          agentRuntimeName: AGENT_NAME,
          agentRuntimeArtifact: {
            codeConfiguration: {
              code: { s3: { bucket, prefix: S3_PREFIX } },
              runtime: "NODE_22",
              entryPoint: ["app.js"],
            },
          },
          roleArn,
          networkConfiguration: { networkMode: "PUBLIC" },
        })
      );
    } catch (error) {
      lastError = error;
      const msg = String(error?.message ?? error);
      // Only retry the transient "execution role not yet assumable" case — not
      // permission errors (e.g. missing service-linked-role rights).
      const roleNotReady =
        /(cannot be assumed|sts:AssumeRole|unable to assume|does not have permission to assume)/i.test(
          msg
        ) && !/service[- ]linked/i.test(msg);
      if (roleNotReady && attempt < 5) {
        log(
          `runtime create attempt ${attempt} failed (role not ready), retrying...`
        );
        await sleep(8000);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

async function waitUntilReady(agentRuntimeId) {
  for (let i = 0; i < 60; i++) {
    const res = await control.send(
      new GetAgentRuntimeCommand({ agentRuntimeId })
    );
    const status = res.status;
    log(`status: ${status}`);
    if (status === "READY") return res;
    if (status && status.endsWith("FAILED")) {
      throw new Error(`Runtime entered ${status}: ${res.statusReason ?? ""}`);
    }
    await sleep(5000);
  }
  throw new Error("Timed out waiting for runtime to become READY.");
}

async function main() {
  const { Account: accountId } = await sts.send(
    new GetCallerIdentityCommand({})
  );
  log(`account: ${accountId}, region: ${REGION}`);

  const bucket = `bedrock-agentcore-code-${accountId}-${REGION}`;
  await ensureBucket(bucket);

  const zip = buildZip();
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: S3_PREFIX, Body: zip })
  );
  log(`uploaded s3://${bucket}/${S3_PREFIX}`);

  const roleArn = await ensureRole(accountId);
  const created = await createRuntime(bucket, roleArn);
  log(`created runtime: ${created.agentRuntimeArn}`);

  await waitUntilReady(created.agentRuntimeId);

  console.log("\n✅ Done. Set this and connect the inspector:\n");
  console.log(`AGENTCORE_RUNTIME_ARN=${created.agentRuntimeArn}`);
  console.log(`AWS_REGION=${REGION}`);
}

main().catch((error) => {
  console.error("\n❌ Deploy failed:", error?.message ?? error);
  process.exit(1);
});

# Lesson 05: AWS Setup Guide — AgentCore Inspector

Everything you need to set up in AWS before running or building the AgentCore Inspector MCP server.

---

## What you'll have at the end

- An IAM user or role with the right permissions
- AWS credentials configured locally
- At least one AgentCore Runtime to inspect
- (Optional) A Memory resource for testing memory tools

---

## Step 1: Create an IAM Policy

In AWS Console → IAM → Policies → **Create Policy**

Select **JSON** and paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock-agentcore:ListSessions",
        "bedrock-agentcore:InvokeAgentRuntime",
        "bedrock-agentcore:CreateEvent",
        "bedrock-agentcore:ListMemoryRecords",
        "bedrock-agentcore:RetrieveMemoryRecords",
        "bedrock-agentcore:GetMemoryRecord",
        "bedrock-agentcore:StartMemoryExtractionJob",
        "bedrock-agentcore:ListMemoryExtractionJobs"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "bedrock-agentcore-control:GetAgentRuntime",
        "bedrock-agentcore-control:ListAgentRuntimes",
        "bedrock-agentcore-control:GetMemory",
        "bedrock-agentcore-control:ListMemories",
        "bedrock-agentcore-control:GetGateway",
        "bedrock-agentcore-control:ListGateways",
        "bedrock-agentcore-control:ListGatewayTargets"
      ],
      "Resource": "*"
    }
  ]
}
```

Name it: `AgentCoreInspectorPolicy`

> **Note:** In production, scope `Resource` to specific ARNs (e.g., `"arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/my-agent"`) instead of `*`.

---

## Step 2: Create an IAM User (dev) or Role (production)

### For local development — IAM User

1. IAM → Users → **Create User**
2. Name: `agentcore-inspector-dev` (or any name)
3. Skip console access (you only need programmatic access)
4. Permissions → Attach policies → select `AgentCoreInspectorPolicy`
5. After creation → **Security credentials** tab → **Create access key**
6. Choose "Local code" as the use case
7. **Save the Access Key ID and Secret Access Key** (shown only once)

### For production — IAM Role

1. IAM → Roles → **Create Role**
2. Trusted entity: AWS Service → **ECS** (or EC2, Lambda — whatever runs your server)
3. Attach `AgentCoreInspectorPolicy`
4. Name: `AgentCoreInspectorRole`
5. Attach the role to your ECS task definition / EC2 instance profile
6. No env vars needed — the AWS SDK picks up the role automatically

---

## Step 3: Configure AWS Credentials Locally

### Option A — `aws configure` (simplest)

```bash
aws configure
# AWS Access Key ID:      paste your key ID
# AWS Secret Access Key:  paste your secret
# Default region name:    us-east-1
# Default output format:  json
```

This writes to `~/.aws/credentials` and `~/.aws/config`.

### Option B — Environment variables (for a single terminal session)

```bash
export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
export AWS_REGION=us-east-1
```

### Option C — AWS SSO (if your org uses it)

```bash
aws sso login --profile your-profile-name
export AWS_PROFILE=your-profile-name
```

### Verify credentials work

```bash
aws sts get-caller-identity
```

Expected output:
```json
{
  "UserId": "AIDAIOSFODNN7EXAMPLE",
  "Account": "123456789012",
  "Arn": "arn:aws:iam::123456789012:user/agentcore-inspector-dev"
}
```

---

## Step 4: Create a Test AgentCore Runtime

You need at least one Runtime to inspect. An "echo" agent is enough for testing.

1. AWS Console → **Amazon Bedrock** → **AgentCore** → **Runtimes** → **Create runtime**

2. Fill in:
   - **Name**: `my-test-agent`
   - **Agent source**: Choose a simple option — a minimal Python or Node.js handler that echoes the input back works fine
   - **Runtime role**: Create a new role or use an existing one (AgentCore creates a service-linked role for networking automatically)

3. After creation, copy the **Runtime ARN**:
   ```
   arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/my-test-agent
   ```

4. Export it:
   ```bash
   export AGENTCORE_RUNTIME_ARN=arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/my-test-agent
   ```

> **Session ID requirement:** AgentCore enforces a minimum **33-character** session ID. Use UUIDs (36 chars):
> ```bash
> node -e "const {randomUUID} = require('crypto'); console.log(randomUUID())"
> ```

---

## Step 5: (Optional) Create a Memory Resource

Only needed if you want to test memory inspection tools (`get-memory-records`, `search-memory`).

1. **Amazon Bedrock → AgentCore → Memory → Create Memory**

2. Fill in:
   - **Name**: `test-memory`
   - **Event expiry duration**: 30 days (good for testing)
   - **Memory strategies**: Add at least one:
     - `semanticMemoryStrategy` — enables semantic search
     - `summaryMemoryStrategy` — extracts session summaries

3. Copy the **Memory ID** (format: `mem-XXXXXXXXXX`):
   ```bash
   export AGENTCORE_MEMORY_ID=mem-XXXXXXXXXX
   ```

4. To populate it with test data, you'll create memory events as part of the inspector server testing.

---

## Step 6: (Optional) Set Up a Gateway

Only needed to test the `list-gateway-targets` tool.

1. **Amazon Bedrock → AgentCore → Gateways → Create Gateway**

2. Register one or more **MCP server targets** (the Gateway acts as a unified MCP endpoint across multiple servers)

3. Copy the **Gateway ID**:
   ```bash
   export AGENTCORE_GATEWAY_ID=gw-XXXXXXXXXX
   ```

---

## Step 7: Set All Environment Variables

Create a `.env` file (do NOT commit this — it's in `.gitignore`):

```bash
# Required
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_REGION=us-east-1
AGENTCORE_RUNTIME_ARN=arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/my-test-agent

# Optional
AGENTCORE_MEMORY_ID=mem-XXXXXXXXXX
AGENTCORE_GATEWAY_ID=gw-XXXXXXXXXX
```

Or source them in your shell:

```bash
source .env
```

---

## Step 8: Verify End-to-End Connectivity

### Test AWS auth

```bash
aws sts get-caller-identity
```

### Test AgentCore data plane access

```bash
aws bedrock-agentcore list-sessions \
  --agent-runtime-arn $AGENTCORE_RUNTIME_ARN \
  --region $AWS_REGION
```

Expected output (even if no sessions exist):
```json
{
  "sessions": []
}
```

### Test memory access (if configured)

```bash
aws bedrock-agentcore list-memory-records \
  --memory-id $AGENTCORE_MEMORY_ID \
  --region $AWS_REGION
```

---

## What you do NOT need to set up

| Thing | Why not needed |
|-------|----------------|
| VPC or private networking | Data plane APIs are public HTTPS endpoints |
| AgentCore Gateway | Only needed if inspecting Gateway tool registrations |
| Any deployment inside AgentCore | The inspector MCP server runs locally, calls AWS from your machine |
| Service-linked roles | AWS creates these automatically when you create a Runtime |
| CloudWatch setup | Only needed if you want to observe tool invocation metrics (not required for the inspector) |

---

## Supported regions (as of May 2026)

AgentCore is available in:
- `us-east-1` (US East — N. Virginia) — recommended for testing
- `us-west-2` (US West — Oregon)
- `eu-west-1` (Europe — Ireland)
- `ap-southeast-1` (Asia Pacific — Singapore)
- `ap-northeast-1` (Asia Pacific — Tokyo)

Check the AWS regional service availability page for the latest list.

---

## Quick reference: environment variable summary

| Variable | Required | Example value |
|----------|----------|---------------|
| `AWS_ACCESS_KEY_ID` | Yes (dev; use IAM role in prod) | `AKIAIOSFODNN7EXAMPLE` |
| `AWS_SECRET_ACCESS_KEY` | Yes (dev) | `wJalrXUtnFEMI/...` |
| `AWS_SESSION_TOKEN` | Only if using STS temp credentials | `FQoGZXIvYXdz...` |
| `AWS_REGION` | Yes | `us-east-1` |
| `AWS_PROFILE` | If using named profiles / SSO | `my-sso-profile` |
| `AGENTCORE_RUNTIME_ARN` | Yes | `arn:aws:bedrock-agentcore:...` |
| `AGENTCORE_MEMORY_ID` | Optional | `mem-XXXXXXXXXX` |
| `AGENTCORE_GATEWAY_ID` | Optional | `gw-XXXXXXXXXX` |

---

## Official AWS docs

- [AgentCore overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html)
- [Create an AgentCore Runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-create.html)
- [AgentCore Memory](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory.html)
- [IAM for AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/security-iam.html)
- [AgentCore SDK (Python)](https://github.com/aws/bedrock-agentcore-sdk-python)
- [AWS open-source MCP server for AgentCore](https://awslabs.github.io/mcp/servers/amazon-bedrock-agentcore-mcp-server)

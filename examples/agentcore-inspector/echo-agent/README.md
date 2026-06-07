# Echo Agent (AgentCore test runtime)

A throwaway Node.js agent you can deploy to **AWS Bedrock AgentCore Runtime** to
give the [AgentCore Inspector](../README.md) something real to inspect. It does
nothing but echo the prompt back.

This is **test scaffolding**, not part of the inspector itself. `node_modules`,
the build dir, and the zip are git-ignored.

## What it is

- `app.js` — Express server with `GET /ping` (health) and `POST /invocations`.
  Listens on port 8080 (AgentCore's fixed runtime port).
- `deploy.mjs` — one-shot deploy via **S3 direct code deploy**: zips the agent,
  uploads it, creates the IAM execution role + runtime, and waits for `READY`.

## Deploy

> Requires AWS credentials with permissions to manage S3, IAM, and AgentCore.
> The script uses the standard AWS provider chain — configure credentials with
> `aws configure`, SSO, env vars, or an IAM role. **Do not** put keys in a repo
> file.

```bash
npm install            # gets express + the deploy-time deps
AWS_REGION=us-east-1 npm run deploy
```

On success it prints the values to use with the inspector:

```
AGENTCORE_RUNTIME_ARN=arn:aws:bedrock-agentcore:us-east-1:<account>:runtime/echo_agent-XXXXXXXXXX
AWS_REGION=us-east-1
```

## What it creates in your account

| Resource          | Name                                        |
| ----------------- | ------------------------------------------- |
| S3 bucket         | `bedrock-agentcore-code-{account}-{region}` |
| IAM role          | `AmazonBedrockAgentCoreSDKRuntime-{region}` |
| AgentCore runtime | `echo_agent` (override with `AGENT_NAME`)   |

The runtime incurs cost while it exists — delete it when you're done testing
(`DeleteAgentRuntime`, or via the Bedrock AgentCore console).

## Notes

- `runtime: "NODE_22"`, `entryPoint: ["app.js"]`, `networkMode: "PUBLIC"`.
- Session IDs for invocation must be **≥ 33 characters** — use a UUID.
- The IAM role uses AWS's "direct deploy execution role" policy (CloudWatch
  Logs + X-Ray + metrics). The echo agent needs no model access; extend the
  policy in `deploy.mjs` if your real agent calls Bedrock models.

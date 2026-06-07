# AgentCore Inspector

An MCP server that exposes **AWS Bedrock AgentCore** state — runtimes, memory,
sessions, and events — as MCP tools and resources. Run it locally and connect it
to [MCPJam Inspector](https://github.com/mcpjam/inspector) (or any MCP client) to
browse your agent's internals live.

The server runs on your machine and makes outbound, SigV4-signed calls to AWS.
Nothing is deployed into AgentCore — it only reads (and optionally invokes) an
agent you already have.

```
MCPJam Inspector  ──stdio──▶  AgentCore Inspector  ──HTTPS──▶  AWS Bedrock AgentCore
                                                               ├─ bedrock-agentcore         (data plane)
                                                               └─ bedrock-agentcore-control (control plane)
```

## Tools

| Tool                  | What it does                                   | AWS API                 |
| --------------------- | ---------------------------------------------- | ----------------------- |
| `list-memories`       | Discover Memory resources (and their ids)      | `ListMemories`          |
| `list-sessions`       | Sessions for an actor in a Memory resource     | `ListSessions`          |
| `list-events`         | Raw events recorded for a session              | `ListEvents`            |
| `get-memory-records`  | Long-term memory records under a namespace     | `ListMemoryRecords`     |
| `search-memory`       | Semantic search over memory records            | `RetrieveMemoryRecords` |
| `get-runtime-info`    | Runtime config and status                      | `GetAgentRuntime`       |
| `get-memory-metadata` | Memory config, strategies, expiry              | `GetMemory`             |
| `invoke-agent`        | Send a payload to a runtime, read the response | `InvokeAgentRuntime`    |

> **Note:** In AgentCore, sessions and events live inside a **Memory** resource
> (scoped by `memoryId` + `actorId`), not under the runtime. Use `list-memories`
> first to find your `memoryId`.

## Resources

| URI                                    | Content                       |
| -------------------------------------- | ----------------------------- |
| `agentcore://memories`                 | JSON list of Memory resources |
| `agentcore://memory/{memoryId}/info`   | Memory configuration          |
| `agentcore://runtime/{runtimeId}/info` | Runtime metadata              |

## Setup

1. **Credentials.** Use any method the AWS SDK understands — `aws configure`,
   SSO (`aws sso login`), an IAM role, or environment variables. Copy
   `.env.example` to `.env` if you prefer env vars.

2. **IAM permissions** (minimum):

   ```
   bedrock-agentcore:ListSessions
   bedrock-agentcore:ListEvents
   bedrock-agentcore:ListMemoryRecords
   bedrock-agentcore:RetrieveMemoryRecords
   bedrock-agentcore:InvokeAgentRuntime
   bedrock-agentcore-control:GetAgentRuntime
   bedrock-agentcore-control:GetMemory
   bedrock-agentcore-control:ListMemories
   ```

3. **Environment variables** (all optional except a region — tools accept the
   same values as arguments):

   | Variable                | Notes                                                   |
   | ----------------------- | ------------------------------------------------------- |
   | `AWS_REGION`            | e.g. `us-east-1` (defaults to `us-east-1`)              |
   | `AGENTCORE_RUNTIME_ARN` | Default runtime for `get-runtime-info` / `invoke-agent` |
   | `AGENTCORE_MEMORY_ID`   | Default Memory for the memory/session tools             |
   | `AGENTCORE_ACTOR_ID`    | Default actor for `list-sessions` / `list-events`       |

See `../../lessons/05-aws-setup-guide.md` for step-by-step AWS console setup.

## Run

```bash
npm install
npm start          # launches the server on stdio
```

## Connect to MCPJam

```bash
npx @mcpjam/inspector@latest
```

In the UI: **Add Server → Command**, then:

- **Command:** `npx`
- **Arguments:** `tsx <abs-path>/server.ts --stdio`

(or build/run with plain `node` if you compile first). Set the AWS env vars in
the server's environment. Once connected, the **Tools** and **Resources** tabs
list everything above — call `list-memories` from the Playground to start.

## Test

```bash
npm test
```

The tests inject mock AWS clients, so they run offline with no credentials.

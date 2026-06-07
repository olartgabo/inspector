# Lesson 02: AWS AgentCore — Overview and How to Build an MCP Inspector Server

## What is AWS AgentCore?

**Amazon Bedrock AgentCore** (launched 2025) is AWS's fully managed runtime for deploying and operating AI agents at production scale. It handles the infrastructure concerns — compute isolation, multi-tenancy, session management, security — so you focus on agent logic.

It uses a **Lambda-like execution model**: when your agent is invoked, AgentCore provisions a lightweight microVM (inside a Spot EC2 instance), keeps it live for the session duration, then tears it down. Each user session gets an isolated compute environment with dedicated CPU, memory, and filesystem.

---

## The 5 Main Components

### 1. AgentCore Runtime
The execution environment for your agent code. Supports:
- Standard HTTP agents (any language/framework)
- **MCP servers** — both stateless and stateful Streamable HTTP (as of March 2026, also supports elicitation, sampling, and progress notifications)
- Per-session microVM isolation
- Built-in auth via AgentCore Identity

### 2. AgentCore Gateway
A managed, centralized **MCP server gateway**. Instead of running and maintaining multiple MCP server endpoints yourself, you register them all with the Gateway, which exposes a single unified MCP endpoint.

Supports target types: REST APIs, Lambda functions, OpenAPI/Smithy specs, and MCP servers.

The Gateway performs a protocol handshake with each registered target via the `SynchronizeGatewayTargets` API — it discovers all available tools and resources from each MCP server and indexes them.

```
Your Agent → AgentCore Gateway (single MCP endpoint)
                 ├── MCP Server A (your tools)
                 ├── MCP Server B (another team's tools)
                 └── REST API C (auto-wrapped as MCP tool)
```

### 3. AgentCore Memory
Persistent context across sessions:
- **Short-term**: Multi-turn conversation captured as events within a session
- **Long-term**: Knowledge extracted across sessions, configurable retention up to 365 days
- Sessions identified by a session ID (minimum 33 characters)

### 4. AgentCore Identity
Manages OAuth flows, API key vaults, and AWS resource access policies for agents. Lets agents call external OAuth-protected services (Salesforce, GitHub, etc.) without hardcoding credentials.

### 5. Code Interpreter
Sandboxed environment for agents to write and execute code at runtime. Safe execution, results returned to the agent.

---

## AWS's Official AgentCore MCP Server

AWS publishes an open-source MCP server for AgentCore itself:
- **122 tools** across 7 operational categories
- Works with Claude Code, Cursor, Kiro, Amazon Q CLI
- Lets you manage AgentCore from inside an MCP-capable IDE

The 7 categories: agent runtime management, identity/credentials, memory operations, gateway ops, session management, code interpreter, registry.

Install:
```bash
npx @aws/bedrock-agentcore-mcp-server
```

Or use it as a reference for how to structure your own AgentCore-aware MCP server.

---

## Building an MCP Server That Inspects AgentCore

The idea: build an MCP server that exposes AgentCore agent **state, sessions, memory, and tool call history as MCP tools and resources**. Connect it to MCPJam Inspector to browse your agent's internals live.

### Architecture

```
MCPJam Inspector
    └── connects to → Your Inspector MCP Server (node.js / Python)
                            └── calls → AWS boto3 / Bedrock SDK
                                            ├── bedrock-agentcore
                                            └── bedrock-agent-runtime
```

### Python implementation pattern

```python
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types
import boto3
import json

server = Server("agentcore-inspector")

agentcore = boto3.client("bedrock-agentcore", region_name="us-east-1")
agent_runtime = boto3.client("bedrock-agent-runtime", region_name="us-east-1")

AGENT_RUNTIME_ARN = "arn:aws:bedrock-agentcore:us-east-1:123456789:runtime/my-agent"

# Tool: inspect agent memory for a session
@server.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "get-agent-memory":
        session_id = arguments["sessionId"]
        response = agent_runtime.get_agent_memory(
            agentId=arguments["agentId"],
            memoryType="SESSION_SUMMARY",
            # sessionId min 33 chars
        )
        return [types.TextContent(type="text", text=json.dumps(response, default=str))]

    if name == "get-client-capabilities":
        # Return what capabilities the last initialize sent
        # (you'd store this when the agent receives an initialize call)
        return [types.TextContent(type="text", text=json.dumps(stored_capabilities))]

# Resource: live session list
@server.list_resources()
async def list_resources():
    return [
        types.Resource(
            uri="agentcore://sessions",
            name="Active Sessions",
            mimeType="application/json",
        )
    ]

@server.read_resource()
async def read_resource(uri: str):
    if uri == "agentcore://sessions":
        # Call AgentCore API to list active sessions
        sessions = agentcore.list_agent_runtime_sessions(
            agentRuntimeId=AGENT_RUNTIME_ARN
        )
        return json.dumps(sessions, default=str)

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())

import asyncio
asyncio.run(main())
```

### Useful tools to expose

| Tool name | What it does | Key AWS call |
|-----------|-------------|-------------|
| `get-agent-memory` | Fetch session memory contents | `agent_runtime.get_agent_memory()` |
| `list-sessions` | List active runtime sessions | `agentcore.list_agent_runtime_sessions()` |
| `get-session-events` | Retrieve conversation turns | `agent_runtime.get_last_k_turns()` |
| `invoke-agent` | Send a prompt and get a response | `agentcore.invoke_agent_runtime()` |
| `get-client-capabilities` | What capabilities did the connecting client send | Store from `initialize` params |
| `get-gateway-targets` | What tools are registered on the Gateway | `agentcore.list_gateway_targets()` |

### Useful resources to expose

| URI | Content |
|-----|---------|
| `agentcore://sessions` | JSON list of active sessions |
| `agentcore://session/{id}/memory` | Memory contents for a session |
| `agentcore://agent/{arn}/info` | Agent runtime metadata |
| `agentcore://gateway/tools` | All tools indexed by the Gateway |

### Key boto3 calls

```python
# Invoke an agent runtime
response = agentcore.invoke_agent_runtime(
    agentRuntimeArn=AGENT_RUNTIME_ARN,
    sessionId="your-session-id-minimum-33-chars-required",
    # payload varies by agent type
)

# Get agent memory
memory = agent_runtime.get_agent_memory(
    agentId="AGENT_ID",
    aliasId="TSTALIASID",
    memoryType="SESSION_SUMMARY",
    maxItems=10,
)

# List gateway targets (what MCP servers are registered)
targets = agentcore.list_gateway_targets(
    gatewayIdentifier="your-gateway-id"
)
```

### Session ID requirement

AgentCore enforces a **minimum 33-character session ID**. Use UUIDs (36 chars) or ULIDs:

```python
import uuid
session_id = str(uuid.uuid4())  # "550e8400-e29b-41d4-a716-446655440000" = 36 chars ✓
```

---

## Connecting Your Inspector Server to MCPJam

Once your server is running:

```bash
# Python stdio server
node mcpjam-inspector/bin/start.js \
  --server "python agentcore_inspector.py" \
  --name "AgentCore Inspector"

# Or if it's an HTTP server
node mcpjam-inspector/bin/start.js \
  --url http://localhost:3001/mcp \
  --name "AgentCore Inspector"
```

Then in MCPJam's **Tools** tab you'll see all your inspection tools. In the **Resources** tab you'll see the session/memory resources. Call them from the Playground to observe your agent's internals live.

---

## Official Docs

- AgentCore Overview: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html
- MCP Getting Started: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/mcp-getting-started.html
- Deploy MCP Servers in Runtime: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-mcp.html
- Gateway MCP Targets: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-target-MCPservers.html
- Stateful MCP Features: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/mcp-stateful-features.html
- Open source AgentCore MCP Server: https://awslabs.github.io/mcp/servers/amazon-bedrock-agentcore-mcp-server

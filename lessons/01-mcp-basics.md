# Lesson 01: MCP Basics — What It Is and How to Build Servers

## What is MCP?

The **Model Context Protocol (MCP)** is an open standard that defines how AI models (like Claude, ChatGPT, Cursor) communicate with external tools, data sources, and services. Think of it as a USB-C standard for AI — instead of every LLM app inventing its own plugin API, they all speak MCP.

The protocol runs over a bidirectional JSON-RPC 2.0 transport. A **client** (the LLM host app) connects to a **server** (your tool/service), and they exchange messages using a well-defined schema.

---

## The Three Primitives

Everything in MCP is one of these three things:

### 1. Tools
Functions the model can **call** to take an action or retrieve computed data.

```json
{
  "name": "get-weather",
  "description": "Returns current weather for a city",
  "inputSchema": {
    "type": "object",
    "properties": { "city": { "type": "string" } },
    "required": ["city"]
  }
}
```

The model decides when to call a tool based on the conversation. Your server executes it and returns a result.

### 2. Resources
Static or dynamic **data** the client can read. Identified by a URI.

```
uri: "file:///logs/agent.log"
uri: "db://users/42/profile"
uri: "ui://my-app/widget.html"  ← MCP Apps HTML widget
```

Resources are like REST GET endpoints — the client fetches them by URI, your server returns content.

### 3. Prompts
**Reusable prompt templates** the client can discover and inject into conversations. Less commonly used but useful for standardized workflows.

---

## Transports: How Client and Server Connect

| Transport | When to use |
|-----------|-------------|
| **stdio** | Local development. Client spawns your server as a child process; they communicate over stdin/stdout. Zero network setup. |
| **Streamable HTTP** | Production. Your server runs as an HTTP endpoint. Supports both stateless and stateful (streaming) modes. |
| **SSE (deprecated)** | Legacy HTTP streaming via Server-Sent Events. Prefer Streamable HTTP for new work. |

---

## The `initialize` Handshake

When a client connects, the first thing it sends is an `initialize` request:

```json
{
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "clientInfo": { "name": "claude-ai", "version": "0.1.0" },
    "capabilities": {
      "elicitation": {},
      "roots": { "listChanged": false },
      "extensions": {
        "io.modelcontextprotocol/ui": {
          "mimeTypes": ["text/html;profile=mcp-app"]
        }
      }
    }
  }
}
```

Your server responds with its own identity and capabilities:

```json
{
  "result": {
    "protocolVersion": "2025-03-26",
    "serverInfo": { "name": "My Server", "version": "1.0.0" },
    "capabilities": {
      "tools": {},
      "resources": {}
    }
  }
}
```

This handshake determines what the session can do. The `clientInfo` is how you know which host app is connecting — Claude, Cursor, ChatGPT, etc.

---

## Building a Minimal MCP Server (Anthropic's SDK)

### Install dependencies

```bash
npm install @modelcontextprotocol/sdk
```

### Minimal stdio server

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "my-server",
  version: "1.0.0",
});

// Register a tool
server.tool(
  "get-time",                              // name
  "Returns the current server time",       // description
  {},                                      // input schema (zod or JSON Schema)
  async () => ({
    content: [{ type: "text", text: new Date().toISOString() }],
  })
);

// Register a resource
server.resource(
  "status://health",
  "Server health status",
  async () => ({
    contents: [{
      uri: "status://health",
      mimeType: "application/json",
      text: JSON.stringify({ status: "ok", uptime: process.uptime() }),
    }],
  })
);

// Connect via stdio
await server.connect(new StdioServerTransport());
```

Run it: `node --loader ts-node/esm server.ts --stdio`

### With input schema validation (zod)

```typescript
import { z } from "zod";

server.tool(
  "add",
  "Adds two numbers",
  { a: z.number(), b: z.number() },
  async ({ a, b }) => ({
    content: [{ type: "text", text: String(a + b) }],
  })
);
```

---

## The MCP Apps Extension: Tools with UI

Standard MCP tools return text/JSON. The **MCP Apps Extension** (`io.modelcontextprotocol/ui`) lets a tool also return an interactive HTML widget. This is the core of MCPJam's "MCP App" concept.

The pattern: a **tool** declares `_meta.ui.resourceUri`, and the client fetches that **resource** (HTML) and renders it in an iframe.

```typescript
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,           // "text/html;profile=mcp-app"
} from "@modelcontextprotocol/ext-apps/server";

const resourceUri = "ui://my-widget/app.html";

// The tool — returns data AND links to a UI
registerAppTool(server, "show-dashboard", {
  title: "Dashboard",
  description: "Shows an interactive dashboard",
  inputSchema: {},
  _meta: { ui: { resourceUri } },
}, async () => ({
  content: [{ type: "text", text: JSON.stringify({ data: [1, 2, 3] }) }],
}));

// The resource — returns the HTML that renders in an iframe
registerAppResource(server, resourceUri, resourceUri,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => ({
    contents: [{
      uri: resourceUri,
      mimeType: RESOURCE_MIME_TYPE,
      text: `<html><body><h1>Dashboard</h1></body></html>`,
    }],
  })
);
```

When the MCP client is UI-capable (Claude, ChatGPT, MCPJam), it will:
1. Call `show-dashboard` → get the text result
2. See `_meta.ui.resourceUri` → fetch `ui://my-widget/app.html`
3. Render the HTML in a sandboxed iframe next to the tool result

Full example: `examples/mcp-apps/express-react-template/server.ts`

---

## HTTP Transport (for production/remote servers)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";

const server = new McpServer({ name: "my-server", version: "1.0.0" });
// ... register tools/resources ...

const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

const httpServer = createServer(async (req, res) => {
  await transport.handleRequest(req, res, await parseBody(req));
});

httpServer.listen(3001);
await server.connect(transport);
```

---

## Connecting Your Server to MCPJam Inspector

Once your server is running, connect it to the inspector:

**stdio server:**
```bash
# From mcpjam-inspector/
node bin/start.js --server "node path/to/server.js --stdio" --name "My Server"
```

**HTTP server:**
```bash
node bin/start.js --url http://localhost:3001/mcp --name "My Server"
```

Or use the MCPJam UI: click "Add Server" → paste your URL or command → hit Connect. You'll see your tools and resources in the Tools and Resources tabs.

---

## Key Resources

- MCP spec: https://spec.modelcontextprotocol.io
- Anthropic SDK: `@modelcontextprotocol/sdk` (npm)
- MCP Apps Extension: `@modelcontextprotocol/ext-apps` (npm)
- Example servers in this repo: `examples/mcp-apps/`

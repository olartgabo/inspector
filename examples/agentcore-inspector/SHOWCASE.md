# Showcase — AWS AgentCore client template + AWS Bedrock provider

This doc shows two features added to the MCPJam Inspector, built alongside the
`agentcore-inspector` MCP server in this folder:

1. **An "AWS AgentCore" client template** — lets you *model AgentCore as an MCP
   client* and test any MCP server as if AgentCore were driving it.
2. **AWS Bedrock as a cloud (LLM) provider** — run the Inspector chat against
   Claude models hosted on Amazon Bedrock, using a Bedrock API key + region.

> **The headline is #1.** It's a pure client-side simulation — no AWS account,
> credentials, or network calls needed to demo it. #2 is complementary and needs
> a Bedrock API key.

---

## What "modeling AgentCore as an MCP client" means

When a host (Claude, ChatGPT, Cursor, a CLI, an agent runtime) connects to an
MCP server, it announces *who it is* and *what it can do* in the MCP
`initialize` handshake — its `clientInfo` and `capabilities`. Server behavior
can legitimately differ per client (e.g. whether to return an interactive
widget). MCPJam's **client templates** let you put the Inspector into the exact
shape of a real client so you can test those differences without deploying
anywhere.

AWS Bedrock **AgentCore** is a headless agent runtime. As of its MCP support it
negotiates **elicitation** and **sampling** (plus progress notifications, which
ride the `_meta` progressToken and need no capability flag), but it does **not**
render MCP Apps widgets — it does not advertise the `io.modelcontextprotocol/ui`
extension. That makes it a *non-widget* client, the same family as the OpenAI
Codex CLI template. The new template encodes exactly that.

What the template advertises (see
`mcpjam-inspector/client/src/lib/client-templates.ts`, `id: "agentcore"`):

```jsonc
// MCP initialize → clientInfo
{ "name": "bedrock-agentcore", "title": "AWS AgentCore", "version": "0.1.0" }

// clientCapabilities (NO io.modelcontextprotocol/ui extension)
{ "elicitation": {}, "sampling": {} }
```

Because the UI extension is absent, `clientAdvertisesMcpApps()`
(`client/src/lib/host-capabilities.ts`) returns `false` and the host renders
**no** SEP-1865 / MCP Apps widgets — proving the server sees AgentCore as a
CLI-style client.

---

## Demo 1 — AgentCore as an MCP client (no AWS needed)

1. Start the Inspector: from `mcpjam-inspector/`, run `npm run dev`.
2. Open the **Clients** area and click to create a client. In the
   *Start from template* grid, pick **AWS AgentCore** (orange Bedrock mark).
   Name it (e.g. "AgentCore") and create.
3. Connect it to an MCP server. Easiest is this folder's server:
   ```bash
   cd examples/agentcore-inspector && npm install && npm start   # stdio
   ```
   or point it at any MCP server you're developing.
4. Open the connection's **initialize** / handshake view and confirm:
   - `clientInfo.name` = `bedrock-agentcore`, `title` = `AWS AgentCore`.
   - capabilities = `{ elicitation, sampling }`, and **no**
     `extensions["io.modelcontextprotocol/ui"]`.
5. **Contrast:** create a second client from the **Claude** or **ChatGPT**
   template and connect to the same server. Those advertise the UI extension, so
   a tool that returns an MCP Apps widget renders an interactive view there but
   **not** under AgentCore. That difference is the whole point — your server can
   tailor responses per client, and now you can test the AgentCore path locally.

_Screenshot placeholders:_
- `![Template picker with AWS AgentCore](./docs/showcase-template-picker.png)`
- `![initialize handshake showing bedrock-agentcore](./docs/showcase-initialize.png)`

---

## Demo 2 — AWS Bedrock provider (Claude on Bedrock)

### AWS console prerequisites (one-time)

The provider uses **Bedrock API-key (Bearer token)** auth + a region — not AWS
access keys / SigV4. To exercise it live you need, in the target region:

1. **Model access** — Bedrock console → *Model access* → enable the Anthropic
   Claude models you want.
2. **A Bedrock API key** — Bedrock console → *API keys* (or an IAM long-term
   key) → copy the Bearer token.
3. **IAM note:** the `agentcore-inspector-dev` user created for this project is
   scoped to AgentCore actions only — it has **no** `bedrock:*` permissions, so
   it can't list models or invoke Bedrock. Use a principal with Bedrock model
   access (or generate the API key under one) for this demo.

### In the app

1. Open **Settings → Providers**. Under self-hosted providers, click
   **AWS Bedrock**.
2. Pick an **AWS Region** (e.g. `us-east-1`) and paste the **Bedrock API key**.
   Save.
3. In the chat model picker, the **AWS Bedrock** group now lists Claude models
   (Sonnet 4.5 / Opus 4.1 / 3.5 Haiku). Pick one and send a message — it streams
   a response routed through `createAmazonBedrock({ apiKey, region })`.

_Screenshot placeholders:_
- `![Bedrock config dialog: region select + API key](./docs/showcase-bedrock-config.png)`
- `![Claude-on-Bedrock model in picker](./docs/showcase-bedrock-models.png)`

---

## Why this matters

- **AgentCore template:** MCP server authors targeting AWS agents can verify the
  AgentCore experience (elicitation/sampling, no widgets) before shipping — no
  AWS account required. It also documents AgentCore's client shape in code.
- **Bedrock provider:** teams already on AWS can drive the Inspector's chat with
  their own Bedrock-hosted Claude, using a single API key + region instead of
  full AWS credential plumbing.

## Where the code lives

| Area | Files |
| --- | --- |
| AgentCore template | `client/src/lib/client-templates.ts` (`id: "agentcore"`); logo `client/public/aws_bedrock_logo.svg` |
| Provider models/types | `shared/types.ts` (`ModelProvider`, `SUPPORTED_MODELS`) |
| Server model factory | `server/utils/chat-helpers.ts` (`createAmazonBedrock` case, `BaseUrls.bedrockRegion`); `server/routes/mcp/chat-v2.ts` |
| Client storage + request | `client/src/hooks/use-ai-provider-keys.ts`, `use-chat-session.ts`, `use-chat.ts`; `shared/chat-v2.ts` |
| Settings UI | `client/src/components/setting/BedrockConfigDialog.tsx`, `components/SettingsTab.tsx` |
| Logos / labels | `client/src/components/chat-v2/shared/chat-helpers.ts`, `model-helpers.ts` |

## Notes / follow-ups

- Auth is intentionally Bedrock-API-key only (no SigV4/IAM credential chain).
- Evals-runner and org-level model config don't yet expose Bedrock (BYOK chat
  path only). Add there if needed for enterprise/evals.
- `aws_bedrock_logo.svg` is a hand-built placeholder mark — swap for an official
  asset when available.

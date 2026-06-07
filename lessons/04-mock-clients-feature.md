# Lesson 04: The "Mock Popular Clients" Feature — What You Need to Know

## What the Feature Is

MCPJam's "mock popular clients" feature lets a **server developer** test their MCP server as if it were being called by Claude, ChatGPT, Cursor, Copilot, or Codex — not just by a generic inspector.

The goal: when you select the "Claude" template and call your tool, your server should see an `initialize` request that is **indistinguishable from the one real claude.ai sends**. Same `clientInfo.name`, same `clientCapabilities`, same `hostInfo` in the widget's `ui/initialize`. Same CSP in the iframe. Same fonts in the widget.

---

## What "Mocking" Means Here

This is **not** unit-test mocking. It means:

> Stamp the correct protocol identity onto the inspector's session so the MCP server under test sees the same connection it would see from the real client.

There are two independent layers to mock:

### Layer 1: MCP Protocol Layer (`initialize` request)

This goes to your **MCP server** (the thing you're testing). Your server receives:

```json
{
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "clientInfo": { "name": "claude-ai", "version": "0.1.0" },
    "capabilities": {
      "roots": { "listChanged": true },
      "extensions": {
        "io.modelcontextprotocol/ui": {
          "mimeTypes": ["text/html;profile=mcp-app"]
        }
      }
    }
  }
}
```

This is the critical part for server developers. If your server branches on `clientInfo.name === "claude-ai"` to enable special behavior, this is where that detection happens.

### Layer 2: MCP Apps Layer (`ui/initialize`)

This goes to the **widget iframe** (the HTML resource your server exposes). The widget receives:

```json
{
  "method": "ui/initialize",
  "params": {
    "hostInfo": { "name": "Claude", "version": "1.0.0" },
    "hostCapabilities": { "openLinks": {}, "downloadFile": {}, ... },
    "hostContext": {
      "theme": "dark",
      "displayMode": "inline",
      "styles": { "variables": { "--color-background-primary": "..." }, ... }
    }
  }
}
```

This is important for **widget UI developers**. If your widget checks `hostInfo.name === "Claude"` to apply Anthropic styling, this is what it reads.

---

## Where Each Layer Lives in the Codebase

### Layer 1: MCP `initialize` → `MCPClientManager`

```
HostConfigInputV2.mcpProfile.initialize.clientInfo
    ↓ read by
sdk/src/mcp-client-manager/MCPClientManager.ts
    ↓ sent as
MCP initialize request → your server
```

When the inspector connects to your server, `MCPClientManager` reads the active host config's `mcpProfile.initialize` and uses it as the params for the `initialize` call. This is how `clientInfo.name` gets set to `"claude-ai"` vs `"openai-mcp"` vs `"cursor-vscode"`.

### Layer 2: Apps `ui/initialize` → renderer

```
HostConfigInputV2.hostCapabilitiesOverride  ─┐
HostConfigInputV2.hostContext               ─┤→ mcp-apps-renderer.tsx → ui/initialize → widget iframe
HostConfigInputV2.mcpProfile.apps.uiInitialize ─┘
```

The renderer reads the host config and assembles the `ui/initialize` message. The `hostInfo.name` (e.g. `"Claude"`) comes from `mcpProfile.apps.uiInitialize.hostInfo`.

### Layer 3: Sandbox/CSP → iframe sandbox

```
HostConfigInputV2.mcpProfile.apps.sandbox
    ↓ read by
sandboxed-iframe.tsx
    ↓ applied as
sandbox= attribute + Content-Security-Policy + Permissions Policy
```

The CSP, `sandboxAttrs`, `allowFeatures`, and `permissions` in the template directly control what the widget iframe can do. This is how "Claude mode" grants `allow-forms` and `'unsafe-eval'` while "Copilot mode" grants nothing.

---

## What You Need to Understand Before Touching This Feature

Work through these in order:

### 1. Read `client-templates.ts` fully (Lesson 03)
You need to understand what each field in a template does before you can add or modify one.

**File:** `mcpjam-inspector/client/src/lib/client-templates.ts`

### 2. Understand `HostConfigInputV2`
This is the shape that `seed()` produces and everything else consumes. Read through all the fields.

**File:** `mcpjam-inspector/client/src/lib/client-config-v2.ts`

Key sections to understand:
- `mcpProfile.initialize` — what goes into the MCP `initialize` call
- `hostCapabilitiesOverride` — what goes into `ui/initialize.hostCapabilities`
- `hostContext` — what goes into `ui/initialize.hostContext`
- `mcpProfile.apps.sandbox` — the CSP/permissions/sandbox config

### 3. Trace how `clientInfo` flows to your server

Open `sdk/src/mcp-client-manager/MCPClientManager.ts` and find where it calls `initialize` on the upstream client. That's where `mcpProfile.initialize.clientInfo` gets used. Understanding this confirms you know where your template's identity ends up.

### 4. Trace how `hostContext` flows to the widget

Open the MCP apps renderer (search for `ui/initialize` in the client source) and see how it constructs the message. This confirms the `hostContext` and `hostCapabilities` from your template actually reach the widget.

### 5. Learn the probe methodology

The gold standard for adding a new client mock is a **live DevTools probe**. Here's how:

**Probing the MCP `initialize` request:**
1. Open the target app (e.g. claude.ai) with DevTools open (F12)
2. Go to Network tab, filter by WS (WebSocket) or Fetch
3. Connect the app to an MCP server you control
4. Find the `initialize` request in the network tab
5. Copy `params.clientInfo` and `params.capabilities`

**Probing the Apps `ui/initialize`:**
1. In the same session, find a tool call that returns an MCP App widget
2. In the Network tab, find the iframe's requests — look for `ui/initialize`
3. Copy `params.hostInfo`, `params.hostCapabilities`, and `params.hostContext`

**Probing the iframe CSP:**
1. In DevTools → Network, click the iframe's HTML resource
2. Look at Response Headers for `Content-Security-Policy`
3. Inspect the iframe element in the DOM: check the `sandbox=` and `allow=` attributes

### 6. Know how to test your template

After adding a new template:

1. Create a client in MCPJam UI using your new template
2. Connect a simple MCP server that logs its `initialize` request:

```typescript
server.server.setRequestHandler(InitializeRequestSchema, async (request) => {
  console.log("Got initialize:", JSON.stringify(request.params, null, 2));
  return { ... };
});
```

3. Verify the logged `clientInfo` and `capabilities` match your probe data
4. Add an App resource (HTML widget) to your server and open it — verify `hostInfo.name` in the widget matches your template
5. Check the iframe's sandbox attribute in DevTools to verify CSP/permissions applied correctly

---

## The Feature Roadmap (What the Team May Want to Build)

The current templates cover 6 clients captured at specific versions. The feature work likely involves:

1. **Keeping templates up to date** — re-probe claude.ai/chatgpt.com periodically as they update their MCP implementations
2. **Adding new clients** — Windsurf, Gemini CLI, Amazon Q, Zed, any new MCP-capable client
3. **Surfacing the probe data in the UI** — showing users exactly what `clientInfo` and capabilities their current template will send before they connect
4. **Version picker** — let users select which version of a client to simulate (e.g. Cursor 3.4.20 vs 3.5.x)
5. **Custom client definition** — let users define their own client identity without writing code

For items 1 and 2, the work is: probe → encode in `client-templates.ts` → test. For items 3-5, there's UI and backend schema work involved.

---

## Quick Reference: Template → Wire Mapping

| Template field | Where it appears on the wire |
|----------------|------------------------------|
| `mcpProfile.initialize.clientInfo` | MCP `initialize` request `params.clientInfo` → your server |
| `clientCapabilities` | MCP `initialize` request `params.capabilities` → your server |
| `mcpProfile.apps.uiInitialize.hostInfo` | `ui/initialize` `params.hostInfo` → widget iframe |
| `hostCapabilitiesOverride` | `ui/initialize` `params.hostCapabilities` → widget iframe |
| `hostContext` | `ui/initialize` `params.hostContext` → widget iframe |
| `mcpProfile.apps.sandbox.csp` | iframe CSP header + `sandbox=` attribute |
| `mcpProfile.apps.sandbox.permissions` | iframe `allow=` Permissions Policy attribute |
| `mcpProfile.apps.compatRuntime.openaiApps` | `window.openai` injected into widget HTML |

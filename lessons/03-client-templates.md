# Lesson 03: Understanding `client-templates.ts`

**File:** `mcpjam-inspector/client/src/lib/client-templates.ts`

---

## The Core Idea

A "client template" in MCPJam is **not** a class or subclass. It's a **configuration seed** — a `seed()` function that returns a complete JSON object (`HostConfigInputV2`) describing how a specific real-world MCP client behaves.

```typescript
interface HostTemplate {
  id: HostTemplateId;       // "mcpjam" | "claude" | "chatgpt" | "cursor" | "codex" | "copilot"
  label: string;
  description: string;
  logoSrc: string;
  seed: (opts?: SeedHostTemplateOptions) => HostConfigInputV2;  // ← everything lives here
}
```

When a user creates a new "Client" in MCPJam and picks "Claude", `seedFromHostTemplate("claude", { theme: "dark" })` is called. It returns a fully-formed JSON config that gets stored and drives the session.

---

## Why Does This Exist?

MCPJam is a **developer tool for testing MCP servers**. A server developer needs to answer: "Does my server behave correctly when *Claude* calls it? What about *Cursor*? What about *ChatGPT*?"

The answer isn't just "send different text" — it's about what the MCP protocol layer sends during `initialize` (which clientInfo? which capabilities?) and what the MCP Apps layer sends in `ui/initialize` (which hostInfo? which CSP rules? which fonts?).

The templates were built by **probing real clients with DevTools** — opening DevTools on claude.ai, chatgpt.com, and Cursor, capturing the actual network requests, and encoding them verbatim into the template. The Claude template's CSS variables and font-face blocks are copied character-for-character from a live `ui/initialize` response.

---

## The Three Config Sections

Every template fills in three sections of `HostConfigInputV2`:

### 1. `hostCapabilitiesOverride`
What capabilities the host **advertises** to widget iframes in `ui/initialize`. This is what the MCP server's widget code uses to know what it can do.

```typescript
base.hostCapabilitiesOverride = {
  openLinks: {},              // can host open external URLs?
  downloadFile: {},           // can host trigger file downloads?
  serverTools: { listChanged: true },  // can widgets call server tools?
  serverResources: {},        // can widgets read server resources?
  logging: {},                // can widgets send log notifications?
  updateModelContext: { text: {}, image: {} },  // can widgets inject content into the model turn?
  message: { text: {} },      // can widgets send a user message?
};
```

Real clients publish only what they actually implement. Cursor doesn't publish `message` or `updateModelContext` because Cursor's UI has no way for a widget to push content back into the chat — so the template leaves those out.

### 2. `hostContext`
The runtime environment context injected into each widget iframe. Tells the widget what kind of host it's running in.

```typescript
base.hostContext = {
  theme: "dark",                  // color scheme
  displayMode: "inline",          // how the widget is shown
  availableDisplayModes: ["inline", "fullscreen"],  // what modes exist
  containerDimensions: { width: 720, maxHeight: 5000 },  // layout policy
  locale: "en-US",
  timeZone: "America/Los_Angeles",
  userAgent: "Mozilla/5.0 ...",   // the host's UA string (verbatim from probe)
  platform: "web",
  deviceCapabilities: { touch: false, hover: true },
  safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  styles: {
    variables: { "--color-background-primary": "...", ... },  // CSS tokens
    css: { fonts: "..." },   // @font-face blocks (e.g. Anthropic Sans for Claude)
  },
};
```

### 3. `mcpProfile`
Two sub-sections:

**`initialize`** — what the client sends in the MCP `initialize` request. This is the **server-facing** identity. Your MCP server receives this.

```typescript
base.mcpProfile = {
  profileVersion: 1,
  initialize: {
    clientInfo: { name: "claude-ai", version: "0.1.0" },
    // optionally: supportedProtocolVersions
  },
  apps: { ... }
};
```

**`apps`** — the MCP Apps extension config. Governs the sandbox the widget runs in.

```typescript
apps: {
  uiInitialize: {
    hostInfo: { name: "Claude", version: "1.0.0" },  // widget reads this
  },
  compatRuntime: { openaiApps: true },   // inject window.openai shim?
  sandbox: {
    csp: {
      mode: "declared",                  // honor widget's own CSP
      cspDirectives: {                   // extra host-layer CSP directives
        "script-src": ["'self'", "'unsafe-eval'", "https://esm.sh"],
        ...
      },
    },
    permissions: {
      mode: "custom",
      allow: { clipboardWrite: true },   // which browser APIs to grant
    },
    sandboxAttrs: ["allow-forms"],       // extra sandbox= attributes
    allowFeatures: { fullscreen: "*" },  // Permissions Policy extras
  },
},
```

---

## The Six Templates at a Glance

### `mcpjam` (default)
**Identity:** `mcpjam-inspector` / `name: "MCPJam"`

The "permissive dev tool" template. Grants everything so any widget works:
- CSP `mode: "declared"` — no host-side restrictions, widget's own CSP is the ceiling
- Grants all permissions (camera, mic, geolocation, clipboardWrite)
- Injects `window.openai` compat shim so OpenAI Apps SDK widgets work too
- Advertises every capability in `hostCapabilitiesOverride`

Use this when you want maximum compatibility and don't care about simulating a specific client.

### `claude`
**Identity:** `claude-ai` / `name: "Claude"`

The highest-fidelity real-client simulation:
- Verbatim Anthropic Sans `@font-face` blocks from a live claude.ai probe
- Verbatim CSS variable set (`--color-background-primary`, etc.) from claude.ai
- `cspDirectives` captured from live `claude.ai` response headers (May 2026)
- `sandboxAttrs: ["allow-forms"]` — real Claude adds this
- `allowFeatures: { fullscreen: "*" }` — real Claude grants fullscreen on the outer iframe
- `permissions: { allow: { clipboardWrite: true } }` — only clipboardWrite

### `chatgpt`
**Identity:** `openai-mcp` / `name: "chatgpt"`

- Adds `experimental: { "openai/visibility": { enabled: true } }` to `clientCapabilities` (real ChatGPT broadcasts this)
- Minimal CSP — real ChatGPT only constrains `frame-src`
- `sandboxAttrs` includes `allow-popups allow-popups-to-escape-sandbox` (from live probe)
- `permissions: { allow: { microphone: true, clipboardWrite: true } }`
- Injects `window.openai` compat shim

### `cursor`
**Identity:** `cursor-vscode` / `name: "Cursor"` version `3.4.20`

- **`respectToolVisibility: false`** — real Cursor 3.4.20 doesn't filter app-only tools from the model
- Adds `elicitation: { form: {} }` and `roots: { listChanged: false }` to `clientCapabilities`
- No `message` or `updateModelContext` in `hostCapabilitiesOverride` (Cursor has no way to let widgets inject into the chat)
- `availableDisplayModes: ["inline"]` — Cursor only renders inline, no fullscreen/pip
- `listChanged: false` explicitly in serverTools/serverResources

### `codex`
**Identity:** `codex-mcp-client` / `name: "Codex"` (OpenAI Codex CLI)

- CLI tool — **no UI renderer at all**
- `hostContext` is left empty (no displayMode, no styles, no fonts needed)
- `clientCapabilities` is **replaced entirely** with `{ elicitation: {} }` — spread would leak the UI extension back in, misrepresenting Codex as UI-capable
- Uses `supportedProtocolVersions: ["2025-06-18"]` — Codex uses a specific protocol version

### `copilot`
**Identity:** `ms-copilot` / `name: "Copilot"` (Microsoft 365)

- `restrictTo: { frameDomains: [] }` — explicit empty allowlist, intent to deny iframe nesting (Copilot doesn't support `frameDomains`)
- `permissions: { allow: {} }` — grants nothing (Copilot ignores widget permission declarations)
- `clientCapabilities` adds `experimental: { "microsoft/copilot": { enabled: true } }`
- `containerDimensions: { maxHeight: 400, maxWidth: 768 }` — Copilot caps widget height at 400px
- Injects `window.openai` compat shim (Copilot routes through OpenAI Apps SDK)

---

## How It's Consumed in the App

```
User clicks "New Client" → CreateClientDialog.tsx
  → picks template pill (Claude, ChatGPT, etc.)
  → calls seedFromHostTemplate(selectedId, { theme: currentTheme })
  → receives HostConfigInputV2
  → POSTs to backend createHost() mutation
  → stored in database
```

At runtime:
```
Playground loads → resolveEffectiveHost() → applyHostDefaultsToPlayground()
  → MCPClientManager reads mcpProfile.initialize.clientInfo
  → sends it in MCP initialize request to your server
  → widget iframe receives hostContext + hostCapabilities from hostCapabilitiesOverride
```

---

## How to Add a New Template (e.g. Windsurf, Gemini CLI)

1. **Add the id** to `HostTemplateId`:
   ```typescript
   export type HostTemplateId = "mcpjam" | "claude" | ... | "windsurf";
   ```

2. **Import a logo** at the top of the file:
   ```typescript
   import windsurfLogo from "/windsurf_logo.png";
   ```

3. **Do a live probe** — open DevTools on the real client:
   - Find the MCP `initialize` request → copy `clientInfo` and `capabilities`
   - Find the `ui/initialize` response → copy `hostInfo`, `hostCapabilities`, `hostContext`
   - Inspect the widget iframe's response headers → copy the CSP directives
   - Check the iframe's `sandbox=` attribute → copy `sandboxAttrs`
   - Check the iframe's `allow=` attribute → copy `allowFeatures`

4. **Push a new entry** into `HOST_TEMPLATES`:
   ```typescript
   {
     id: "windsurf",
     label: "Windsurf",
     description: "Codeium Windsurf IDE.",
     logoSrc: windsurfLogo,
     seed: (opts) => {
       const base = emptyHostConfigInputV2({ hostStyle: "windsurf", ... });
       base.hostCapabilitiesOverride = { /* from probe */ };
       base.hostContext = { /* from probe */ };
       base.mcpProfile = { /* from probe */ };
       return base;
     },
   },
   ```

5. **Test it**: Create the client in MCPJam UI, connect a server that logs `initialize` params, verify the received `clientInfo.name` matches the real client.

---

## Key Supporting Files

| File | What it is |
|------|-----------|
| `mcpjam-inspector/client/src/lib/client-config-v2.ts` | `HostConfigInputV2` type definition — the shape that `seed()` must return |
| `mcpjam-inspector/client/src/components/clients/CreateClientDialog.tsx` | UI that calls `seedFromHostTemplate()` |
| `mcpjam-inspector/client/src/lib/playground/apply-client-defaults.ts` | Syncs playground chips when switching templates |
| `sdk/src/mcp-client-manager/MCPClientManager.ts` | Reads `mcpProfile.initialize` and sends it as the MCP `initialize` request |

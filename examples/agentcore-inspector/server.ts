/**
 * AgentCore Inspector — an MCP server that exposes AWS Bedrock AgentCore
 * state (runtimes, memory, sessions, events) as MCP tools and resources.
 *
 * It runs locally and makes outbound, SigV4-signed calls to AWS. Connect it to
 * MCPJam Inspector (or any MCP client) to browse agent internals live.
 *
 * Credentials are resolved by the AWS SDK's default provider chain
 * (environment variables, shared config/credentials files, SSO, or an IAM
 * role). See README.md for the minimum IAM policy and env vars.
 */

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import {
  BedrockAgentCoreClient,
  ListSessionsCommand,
  ListEventsCommand,
  ListMemoryRecordsCommand,
  RetrieveMemoryRecordsCommand,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import {
  BedrockAgentCoreControlClient,
  GetAgentRuntimeCommand,
  GetMemoryCommand,
  ListMemoriesCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";
import { z } from "zod";

// --- Configuration -------------------------------------------------------

export interface InspectorConfig {
  region: string;
  /** Default runtime ARN used when a tool/resource omits one. */
  runtimeArn?: string;
  /** Default Memory resource id used when a tool/resource omits one. */
  memoryId?: string;
  /** Default actor id used when listing sessions/events. */
  actorId?: string;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env
): InspectorConfig {
  return {
    region: env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? "us-east-1",
    runtimeArn: env.AGENTCORE_RUNTIME_ARN,
    memoryId: env.AGENTCORE_MEMORY_ID,
    actorId: env.AGENTCORE_ACTOR_ID,
  };
}

/**
 * `GetAgentRuntime` takes the runtime *id*, not the full ARN. Accept either and
 * extract the id (the segment after `runtime/`).
 */
export function runtimeIdFromArn(arnOrId: string): string {
  const match = arnOrId.match(/runtime\/([^/]+)$/);
  return match ? match[1] : arnOrId;
}

// --- Client surface (minimal, for dependency injection in tests) ---------

export interface SendClient {
  send(command: unknown): Promise<Record<string, unknown>>;
}

export interface AgentCoreClients {
  data: SendClient;
  control: SendClient;
}

// --- Result helpers ------------------------------------------------------

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Resolve a value from explicit args, then config, else return an error. */
function require_(
  value: string | undefined,
  fallback: string | undefined,
  label: string
): { value: string } | { error: CallToolResult } {
  const resolved = value ?? fallback;
  if (!resolved) {
    return {
      error: errorResult(
        `Missing ${label}. Pass it as an argument or set the corresponding environment variable.`
      ),
    };
  }
  return { value: resolved };
}

// --- Tool handlers (exported for unit testing) ---------------------------

export async function listSessions(
  data: SendClient,
  args: { memoryId?: string; actorId?: string; maxResults?: number },
  config: InspectorConfig
): Promise<CallToolResult> {
  const memory = require_(args.memoryId, config.memoryId, "memoryId");
  if ("error" in memory) return memory.error;
  const actor = require_(args.actorId, config.actorId, "actorId");
  if ("error" in actor) return actor.error;

  const res = await data.send(
    new ListSessionsCommand({
      memoryId: memory.value,
      actorId: actor.value,
      maxResults: args.maxResults,
    })
  );
  return jsonResult(res.sessionSummaries ?? res);
}

export async function listEvents(
  data: SendClient,
  args: {
    sessionId: string;
    memoryId?: string;
    actorId?: string;
    includePayloads?: boolean;
    maxResults?: number;
  },
  config: InspectorConfig
): Promise<CallToolResult> {
  const memory = require_(args.memoryId, config.memoryId, "memoryId");
  if ("error" in memory) return memory.error;
  const actor = require_(args.actorId, config.actorId, "actorId");
  if ("error" in actor) return actor.error;

  const res = await data.send(
    new ListEventsCommand({
      memoryId: memory.value,
      actorId: actor.value,
      sessionId: args.sessionId,
      includePayloads: args.includePayloads ?? true,
      maxResults: args.maxResults,
    })
  );
  return jsonResult(res.events ?? res);
}

export async function getMemoryRecords(
  data: SendClient,
  args: { namespace: string; memoryId?: string; maxResults?: number },
  config: InspectorConfig
): Promise<CallToolResult> {
  const memory = require_(args.memoryId, config.memoryId, "memoryId");
  if ("error" in memory) return memory.error;

  const res = await data.send(
    new ListMemoryRecordsCommand({
      memoryId: memory.value,
      namespace: args.namespace,
      maxResults: args.maxResults,
    })
  );
  return jsonResult(res.memoryRecordSummaries ?? res);
}

export async function searchMemory(
  data: SendClient,
  args: {
    searchQuery: string;
    memoryId?: string;
    namespace?: string;
    topK?: number;
  },
  config: InspectorConfig
): Promise<CallToolResult> {
  const memory = require_(args.memoryId, config.memoryId, "memoryId");
  if ("error" in memory) return memory.error;

  const res = await data.send(
    new RetrieveMemoryRecordsCommand({
      memoryId: memory.value,
      namespace: args.namespace,
      searchCriteria: { searchQuery: args.searchQuery, topK: args.topK ?? 10 },
    })
  );
  return jsonResult(res.memoryRecordSummaries ?? res);
}

export async function getRuntimeInfo(
  control: SendClient,
  args: { runtimeArn?: string },
  config: InspectorConfig
): Promise<CallToolResult> {
  const runtime = require_(args.runtimeArn, config.runtimeArn, "runtimeArn");
  if ("error" in runtime) return runtime.error;

  const res = await control.send(
    new GetAgentRuntimeCommand({
      agentRuntimeId: runtimeIdFromArn(runtime.value),
    })
  );
  return jsonResult(res);
}

export async function getMemoryMetadata(
  control: SendClient,
  args: { memoryId?: string },
  config: InspectorConfig
): Promise<CallToolResult> {
  const memory = require_(args.memoryId, config.memoryId, "memoryId");
  if ("error" in memory) return memory.error;

  const res = await control.send(
    new GetMemoryCommand({ memoryId: memory.value })
  );
  return jsonResult(res.memory ?? res);
}

export async function listMemories(
  control: SendClient,
  args: { maxResults?: number }
): Promise<CallToolResult> {
  const res = await control.send(
    new ListMemoriesCommand({ maxResults: args.maxResults })
  );
  return jsonResult(res.memories ?? res);
}

/** Decode an InvokeAgentRuntime response body to a string, regardless of form. */
async function decodeInvokeResponse(
  response: unknown
): Promise<string | undefined> {
  if (response == null) return undefined;
  if (typeof response === "string") return response;
  if (
    typeof (response as { transformToString?: () => Promise<string> })
      .transformToString === "function"
  ) {
    return (
      response as { transformToString: () => Promise<string> }
    ).transformToString();
  }
  if (response instanceof Uint8Array) return new TextDecoder().decode(response);
  return JSON.stringify(response);
}

export async function invokeAgent(
  data: SendClient,
  args: { payload: string; runtimeArn?: string; runtimeSessionId?: string },
  config: InspectorConfig
): Promise<CallToolResult> {
  const runtime = require_(args.runtimeArn, config.runtimeArn, "runtimeArn");
  if ("error" in runtime) return runtime.error;

  const res = await data.send(
    new InvokeAgentRuntimeCommand({
      agentRuntimeArn: runtime.value,
      runtimeSessionId: args.runtimeSessionId,
      contentType: "application/json",
      accept: "application/json",
      payload: new TextEncoder().encode(args.payload),
    })
  );
  const body = await decodeInvokeResponse(res.response);
  return jsonResult({
    statusCode: res.statusCode,
    contentType: res.contentType,
    runtimeSessionId: res.runtimeSessionId,
    response: body,
  });
}

// --- Server assembly -----------------------------------------------------

export function createServer(
  clients?: Partial<AgentCoreClients>,
  config: InspectorConfig = loadConfig()
): McpServer {
  const data: SendClient =
    clients?.data ?? new BedrockAgentCoreClient({ region: config.region });
  const control: SendClient =
    clients?.control ??
    new BedrockAgentCoreControlClient({ region: config.region });

  const server = new McpServer({
    name: "agentcore-inspector",
    version: "0.1.0",
    description:
      "Inspect AWS Bedrock AgentCore runtimes, memory, sessions, and events as MCP tools and resources.",
  });

  // Tools ----------------------------------------------------------------

  server.registerTool(
    "list-memories",
    {
      title: "List Memories",
      description:
        "List AgentCore Memory resources in the account/region. Use this to discover the memoryId for the other tools.",
      inputSchema: {
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max results to return (1-100)."),
      },
    },
    (args) => listMemories(control, args)
  );

  server.registerTool(
    "list-sessions",
    {
      title: "List Sessions",
      description:
        "List sessions for an actor within an AgentCore Memory resource. memoryId and actorId default to env (AGENTCORE_MEMORY_ID / AGENTCORE_ACTOR_ID) when omitted.",
      inputSchema: {
        memoryId: z.string().optional().describe("AgentCore Memory id."),
        actorId: z
          .string()
          .optional()
          .describe("Actor id (e.g. an end-user identifier)."),
        maxResults: z.number().int().min(1).max(100).optional(),
      },
    },
    (args) => listSessions(data, args, config)
  );

  server.registerTool(
    "list-events",
    {
      title: "List Session Events",
      description:
        "List the raw events (the short-term conversation/tool activity) recorded for a session.",
      inputSchema: {
        sessionId: z
          .string()
          .describe("Session id to inspect (must be >= 33 characters)."),
        memoryId: z.string().optional(),
        actorId: z.string().optional(),
        includePayloads: z
          .boolean()
          .optional()
          .describe("Include event payloads in the response (default true)."),
        maxResults: z.number().int().min(1).max(100).optional(),
      },
    },
    (args) => listEvents(data, args, config)
  );

  server.registerTool(
    "get-memory-records",
    {
      title: "Get Memory Records",
      description:
        "List long-term memory records (LLM-extracted insights) under a namespace prefix.",
      inputSchema: {
        namespace: z
          .string()
          .describe(
            "Namespace prefix to filter records, e.g. '/facts/user123'."
          ),
        memoryId: z.string().optional(),
        maxResults: z.number().int().min(1).max(100).optional(),
      },
    },
    (args) => getMemoryRecords(data, args, config)
  );

  server.registerTool(
    "search-memory",
    {
      title: "Search Memory",
      description:
        "Semantic search over long-term memory records for the given query.",
      inputSchema: {
        searchQuery: z.string().describe("Natural-language search query."),
        memoryId: z.string().optional(),
        namespace: z
          .string()
          .optional()
          .describe("Optional namespace to scope the search."),
        topK: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Number of top matches to return (default 10)."),
      },
    },
    (args) => searchMemory(data, args, config)
  );

  server.registerTool(
    "get-runtime-info",
    {
      title: "Get Runtime Info",
      description:
        "Get configuration and status for an AgentCore Runtime. Accepts a full ARN or a runtime id; defaults to env (AGENTCORE_RUNTIME_ARN).",
      inputSchema: {
        runtimeArn: z
          .string()
          .optional()
          .describe("Runtime ARN or id to inspect."),
      },
    },
    (args) => getRuntimeInfo(control, args, config)
  );

  server.registerTool(
    "get-memory-metadata",
    {
      title: "Get Memory Metadata",
      description:
        "Get the configuration of a Memory resource: strategies, event expiry, status.",
      inputSchema: {
        memoryId: z.string().optional(),
      },
    },
    (args) => getMemoryMetadata(control, args, config)
  );

  server.registerTool(
    "invoke-agent",
    {
      title: "Invoke Agent",
      description:
        "Send a payload to an AgentCore Runtime and return its response. The payload is sent as the raw request body (JSON recommended).",
      inputSchema: {
        payload: z
          .string()
          .describe('Request body to send, e.g. \'{"prompt":"hello"}\'.'),
        runtimeArn: z.string().optional().describe("Runtime ARN to invoke."),
        runtimeSessionId: z
          .string()
          .optional()
          .describe(
            "Optional session id to continue a session (must be >= 33 characters)."
          ),
      },
    },
    (args) => invokeAgent(data, args, config)
  );

  // Resources ------------------------------------------------------------

  server.registerResource(
    "memories",
    "agentcore://memories",
    {
      title: "AgentCore Memories",
      description: "JSON list of Memory resources in the account/region.",
      mimeType: "application/json",
    },
    async (uri): Promise<ReadResourceResult> => {
      const res = await control.send(new ListMemoriesCommand({}));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(res.memories ?? res, null, 2),
          },
        ],
      };
    }
  );

  server.registerResource(
    "memory-info",
    new ResourceTemplate("agentcore://memory/{memoryId}/info", {
      list: undefined,
    }),
    {
      title: "Memory Metadata",
      description: "Configuration and strategies for a Memory resource.",
      mimeType: "application/json",
    },
    async (uri, variables): Promise<ReadResourceResult> => {
      const memoryId = String(variables.memoryId);
      const res = await control.send(new GetMemoryCommand({ memoryId }));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(res.memory ?? res, null, 2),
          },
        ],
      };
    }
  );

  server.registerResource(
    "runtime-info",
    new ResourceTemplate("agentcore://runtime/{runtimeId}/info", {
      list: undefined,
    }),
    {
      title: "Runtime Metadata",
      description: "Configuration and status for an AgentCore Runtime.",
      mimeType: "application/json",
    },
    async (uri, variables): Promise<ReadResourceResult> => {
      const res = await control.send(
        new GetAgentRuntimeCommand({
          agentRuntimeId: runtimeIdFromArn(String(variables.runtimeId)),
        })
      );
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(res, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

// --- Entry point ---------------------------------------------------------

async function main(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
  // stderr is safe to log to under stdio (stdout carries the MCP protocol).
  console.error("AgentCore Inspector MCP server running on stdio.");
}

// Only run when executed directly, not when imported by tests.
const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain || process.argv.includes("--stdio")) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

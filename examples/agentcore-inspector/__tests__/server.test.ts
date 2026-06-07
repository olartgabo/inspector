import { describe, it, expect, vi } from "vitest";
import {
  loadConfig,
  runtimeIdFromArn,
  listSessions,
  listEvents,
  getMemoryRecords,
  searchMemory,
  getRuntimeInfo,
  getMemoryMetadata,
  listMemories,
  invokeAgent,
  type InspectorConfig,
  type SendClient,
} from "../server.ts";

const CONFIG: InspectorConfig = {
  region: "us-east-1",
  runtimeArn:
    "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/agent-abc123",
  memoryId: "mem-default0001",
  actorId: "actor-default",
};

/** A mock client whose `send` resolves to `result` and records the command. */
function mockClient(result: Record<string, unknown> = {}): SendClient & {
  send: ReturnType<typeof vi.fn>;
} {
  return { send: vi.fn().mockResolvedValue(result) };
}

/** The command object passed to the most recent `send` call. */
function lastCommand(client: { send: ReturnType<typeof vi.fn> }) {
  return client.send.mock.calls.at(-1)?.[0] as {
    constructor: { name: string };
    input: Record<string, unknown>;
  };
}

function textOf(result: { content: unknown }): string {
  const content = result.content as Array<{ text?: string }>;
  return content.map((c) => c.text ?? "").join("");
}

describe("runtimeIdFromArn", () => {
  it("extracts the id from a full ARN", () => {
    expect(
      runtimeIdFromArn(
        "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/my-agent-xyz"
      )
    ).toBe("my-agent-xyz");
  });

  it("passes a bare id through unchanged", () => {
    expect(runtimeIdFromArn("my-agent-xyz")).toBe("my-agent-xyz");
  });
});

describe("loadConfig", () => {
  it("defaults region to us-east-1 and reads AgentCore env vars", () => {
    const config = loadConfig({
      AGENTCORE_RUNTIME_ARN: "arn:runtime/x",
      AGENTCORE_MEMORY_ID: "mem-1",
    } as NodeJS.ProcessEnv);
    expect(config.region).toBe("us-east-1");
    expect(config.runtimeArn).toBe("arn:runtime/x");
    expect(config.memoryId).toBe("mem-1");
  });

  it("honors AWS_REGION", () => {
    expect(
      loadConfig({ AWS_REGION: "eu-west-1" } as NodeJS.ProcessEnv).region
    ).toBe("eu-west-1");
  });
});

describe("listSessions", () => {
  it("sends ListSessionsCommand with memoryId + actorId and returns summaries", async () => {
    const client = mockClient({ sessionSummaries: [{ sessionId: "s1" }] });
    const result = await listSessions(client, { actorId: "actor-9" }, CONFIG);

    const cmd = lastCommand(client);
    expect(cmd.constructor.name).toBe("ListSessionsCommand");
    expect(cmd.input.memoryId).toBe("mem-default0001"); // from config
    expect(cmd.input.actorId).toBe("actor-9"); // explicit arg wins
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain("s1");
  });

  it("errors (without calling AWS) when memoryId is missing", async () => {
    const client = mockClient();
    const result = await listSessions(
      client,
      { actorId: "a" },
      { region: "us-east-1" }
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("memoryId");
    expect(client.send).not.toHaveBeenCalled();
  });
});

describe("listEvents", () => {
  it("requires a sessionId and defaults includePayloads to true", async () => {
    const client = mockClient({ events: [] });
    await listEvents(client, { sessionId: "session-123" }, CONFIG);
    const cmd = lastCommand(client);
    expect(cmd.constructor.name).toBe("ListEventsCommand");
    expect(cmd.input.sessionId).toBe("session-123");
    expect(cmd.input.includePayloads).toBe(true);
  });
});

describe("getMemoryRecords", () => {
  it("sends ListMemoryRecordsCommand with namespace", async () => {
    const client = mockClient({ memoryRecordSummaries: [] });
    await getMemoryRecords(client, { namespace: "/facts" }, CONFIG);
    const cmd = lastCommand(client);
    expect(cmd.constructor.name).toBe("ListMemoryRecordsCommand");
    expect(cmd.input.namespace).toBe("/facts");
    expect(cmd.input.memoryId).toBe("mem-default0001");
  });
});

describe("searchMemory", () => {
  it("builds searchCriteria with the query and topK", async () => {
    const client = mockClient({ memoryRecordSummaries: [] });
    await searchMemory(
      client,
      { searchQuery: "what is the user's name", topK: 5 },
      CONFIG
    );
    const cmd = lastCommand(client);
    expect(cmd.constructor.name).toBe("RetrieveMemoryRecordsCommand");
    expect(cmd.input.searchCriteria).toEqual({
      searchQuery: "what is the user's name",
      topK: 5,
    });
  });
});

describe("getRuntimeInfo", () => {
  it("passes the runtime id (not the ARN) to GetAgentRuntimeCommand", async () => {
    const client = mockClient({ status: "READY" });
    await getRuntimeInfo(client, {}, CONFIG);
    const cmd = lastCommand(client);
    expect(cmd.constructor.name).toBe("GetAgentRuntimeCommand");
    expect(cmd.input.agentRuntimeId).toBe("agent-abc123");
  });
});

describe("getMemoryMetadata", () => {
  it("sends GetMemoryCommand and unwraps the memory field", async () => {
    const client = mockClient({ memory: { id: "mem-1", status: "ACTIVE" } });
    const result = await getMemoryMetadata(
      client,
      { memoryId: "mem-1" },
      CONFIG
    );
    expect(lastCommand(client).constructor.name).toBe("GetMemoryCommand");
    expect(textOf(result)).toContain("ACTIVE");
  });
});

describe("listMemories", () => {
  it("sends ListMemoriesCommand and needs no config", async () => {
    const client = mockClient({ memories: [{ id: "mem-1" }] });
    const result = await listMemories(client, { maxResults: 10 });
    const cmd = lastCommand(client);
    expect(cmd.constructor.name).toBe("ListMemoriesCommand");
    expect(cmd.input.maxResults).toBe(10);
    expect(textOf(result)).toContain("mem-1");
  });
});

describe("invokeAgent", () => {
  it("encodes the payload to bytes and decodes a streaming response", async () => {
    const client = mockClient({
      statusCode: 200,
      contentType: "application/json",
      runtimeSessionId: "x".repeat(33),
      response: { transformToString: async () => '{"reply":"hi"}' },
    });
    const result = await invokeAgent(
      client,
      { payload: '{"prompt":"hello"}' },
      CONFIG
    );

    const cmd = lastCommand(client);
    expect(cmd.constructor.name).toBe("InvokeAgentRuntimeCommand");
    expect(cmd.input.agentRuntimeArn).toBe(CONFIG.runtimeArn);
    expect(cmd.input.payload).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(cmd.input.payload as Uint8Array)).toBe(
      '{"prompt":"hello"}'
    );
    expect(textOf(result)).toContain('{\\"reply\\":\\"hi\\"}');
  });

  it("decodes a Uint8Array response body", async () => {
    const client = mockClient({
      statusCode: 200,
      response: new TextEncoder().encode("plain-text-reply"),
    });
    const result = await invokeAgent(client, { payload: "{}" }, CONFIG);
    expect(textOf(result)).toContain("plain-text-reply");
  });
});

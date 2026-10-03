import type {
  JsonValue,
  NetworkEventStream,
  NetworkResponse,
  PluginContext,
} from "workbuddy-byok:plugin";
import type { LlmRequest, ModelEvent } from "workbuddy-byok:provider";
import type { ResourceSnapshot } from "workbuddy-byok:resource";
import { antigravityProvider, isQuotaError } from "./provider.ts";
import { parseAntigravityModels } from "./models.ts";
import { RESOURCE_TYPE } from "./resources.ts";

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`expected ${right}, received ${left}`);
}

type RequestInit = { body?: string; headers?: Record<string, string> };
type FetchHandler = (url: string, init?: RequestInit) => NetworkResponse;
type StreamHandler = (url: string, init?: RequestInit) => NetworkEventStream;

function context(handlers: { fetch?: FetchHandler; stream?: StreamHandler }): PluginContext {
  return {
    network: {
      fetch: (url, init) => {
        if (!handlers.fetch) throw new Error("fetch was not expected");
        return Promise.resolve(handlers.fetch(url, init));
      },
      stream: (url, init) => {
        if (!handlers.stream) throw new Error("stream was not expected");
        return Promise.resolve(handlers.stream(url, init));
      },
    },
    signal: new AbortController().signal,
  };
}

function snapshot(privateData: JsonValue): ResourceSnapshot {
  return {
    id: "resource-1",
    type: RESOURCE_TYPE,
    key: "antigravity:user-1",
    privateData,
    state: { status: "ready" },
  };
}

async function* sse(lines: string[]): AsyncGenerator<string> {
  for (const line of lines) yield line;
}

function request(): LlmRequest {
  return {
    instructions: "You are an AI coding assistant.",
    messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    tools: [],
    reasoning: { enabled: true, effort: "medium" },
    latency: "standard",
    maxOutputTokens: 65536,
    cacheKey: "conv-1",
  };
}

Deno.test("provider routes grouped models to the discovered strength including disabled thinking", async () => {
  const model = parseAntigravityModels({
    models: {
      "upstream-none": { displayName: "Gemini Flash (None)" },
      "upstream-low": { displayName: "Gemini Flash (Low)", supportsThinking: true },
      "upstream-medium": { displayName: "Gemini Flash (Medium)", supportsThinking: true },
      "upstream-high": { displayName: "Gemini Flash (High)", supportsThinking: true },
    },
  })[0];
  for (const effort of [null, "none", "low", "medium", "high"]) {
    const llmRequest = request();
    llmRequest.reasoning = { enabled: effort !== "none", effort };
    let calls = 0;
    const result = await antigravityProvider.invoke(
      {
        model,
        resource: snapshot({
          accessToken: "mock-token",
          expiresAt: Date.now() + 3600_000,
          projectId: "test-project",
        }),
        request: llmRequest,
      },
      { emit: () => {} },
      context({
        stream: (_url, init) => {
          calls++;
          assertEquals(
            JSON.parse(init?.body ?? "{}").model,
            effort === null ? model.id : `upstream-${effort}`,
          );
          return {
            status: 200,
            headers: {},
            lines: sse(['data: {"response":{"candidates":[{"finishReason":"STOP"}]}}']),
          };
        },
      }),
    );
    assertEquals(result, { status: "completed" });
    assertEquals(calls, 1);
  }
});

Deno.test("provider rejects unavailable strengths before any network request", async () => {
  const model = parseAntigravityModels({
    models: {
      "upstream-high": { displayName: "Gemini Pro (High)", supportsThinking: true },
    },
  })[0];
  for (const effort of ["medium", "none"]) {
    const llmRequest = request();
    llmRequest.reasoning = { enabled: effort !== "none", effort };
    const result = await antigravityProvider.invoke({
      model,
      resource: snapshot({ accessToken: "mock-token", projectId: "test-project" }),
      request: llmRequest,
    }, {
      emit: () => {
        throw new Error("unexpected event");
      },
    }, context({}));
    assertEquals(result.status, "request-error");
    assert("message" in result && result.message?.includes(`'${effort}'`));
  }
});

Deno.test("provider parses usage metadata including cachedContentTokenCount as cacheReadTokens", async () => {
  let requestBody = "";
  let requestHeaders: Record<string, string> = {};
  const events: ModelEvent[] = [];

  const result = await antigravityProvider.invoke(
    {
      model: {
        id: "gemini-3.7-flash-medium",
        displayName: "Gemini 3.7 Flash Medium",
        privateData: {},
      },
      resource: snapshot({
        accessToken: "mock-access-token",
        refreshToken: "mock-refresh-token",
        expiresAt: Date.now() + 3600_000,
        projectId: "test-project-123",
      }),
      request: request(),
    },
    { emit: (event) => events.push(event) },
    context({
      stream: (url, init) => {
        assert(url.includes("/v1internal:streamGenerateContent?alt=sse"));
        requestBody = init?.body ?? "";
        requestHeaders = init?.headers ?? {};
        return {
          status: 200,
          headers: {},
          lines: sse([
            'data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"Thinking..."}]}}]}}',
            'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello world"}]}}]}}',
            'data: {"response":{"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":120,"candidatesTokenCount":15,"totalTokenCount":135,"cachedContentTokenCount":80}}}',
          ]),
        };
      },
    }),
  );

  assertEquals(result, { status: "completed" });
  assertEquals(requestHeaders["authorization"], "Bearer mock-access-token");
  assertEquals(requestHeaders.accept, "text/event-stream");
  assert(!("session-id" in requestHeaders), "Codex-only session-id header was sent");
  assert(!("thread-id" in requestHeaders), "Codex-only thread-id header was sent");
  assert(!("x-client-request-id" in requestHeaders), "request-id header was reused as cache key");
  const body = JSON.parse(requestBody) as Record<string, unknown>;
  assertEquals(body.project, "test-project-123");
  assertEquals(body.model, "gemini-3.7-flash-medium");
  assert(!("sessionId" in body), "unsupported sessionId field was sent");
  assert(!("conversationId" in body), "unsupported conversationId field was sent");

  assertEquals(events, [
    { type: "thinking-start" },
    { type: "thinking-delta", text: "Thinking..." },
    { type: "thinking-end" },
    { type: "text-start" },
    { type: "text-delta", text: "Hello world" },
    { type: "text-end" },
    {
      type: "usage",
      usage: {
        inputTokens: 120,
        outputTokens: 15,
        totalTokens: 135,
        cacheReadTokens: 80,
        cacheWriteTokens: null,
        reasoningTokens: null,
      },
    },
    { type: "done", reason: "stop" },
  ]);
});

Deno.test("isQuotaError identifies rate limits and quota exhaustion", () => {
  assert(isQuotaError("RESOURCE_EXHAUSTED: quota exceeded"));
  assert(isQuotaError("Rate limit exceeded for model"));
  assert(isQuotaError("HTTP 429 Too Many Requests"));
  assert(!isQuotaError("Invalid authorization header"));
});

for (const modelId of ["gemini-pro-agent", "claude-opus-4-6-thinking"]) {
  Deno.test(`${modelId} preserves standard JSON Schema including unions and property names`, async () => {
    const llmRequest = request();
    llmRequest.tools = [{
      name: "show_widget",
      description: "Render a widget",
      parameters: {
        type: "object",
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: "Widget schema",
        additionalProperties: false,
        $defs: { label: { type: "string", minLength: 1 } },
        properties: {
          title: { type: "string", title: "Widget title", default: "Untitled" },
          default: { type: "string" },
          type: { type: "string" },
          format: { type: "string" },
          nested: {
            type: "array",
            items: {
              type: "object",
              properties: { title: { $ref: "#/$defs/label" } },
              required: ["title"],
            },
          },
        },
        required: ["title", "default", "type", "format"],
      },
    }, {
      name: "widget_guidelines",
      description: "Get widget guidelines",
      parameters: {
        type: "object",
        properties: {
          modules: {
            anyOf: [{ type: "array", items: { type: "string" } }, { type: "string" }],
          },
          optional: { type: ["string", "null"] },
        },
        required: ["modules"],
      },
    }];
    const originalTools = JSON.stringify(llmRequest.tools);
    let calls = 0;
    const result = await antigravityProvider.invoke(
      {
        model: { id: modelId, displayName: modelId, privateData: {} },
        resource: snapshot({
          accessToken: "mock-token",
          expiresAt: Date.now() + 3600_000,
          projectId: "test-project",
        }),
        request: llmRequest,
      },
      { emit: () => {} },
      context({
        stream: (_url, init) => {
          calls++;
          const body = JSON.parse(init?.body ?? "{}");
          const declarations = body.request.tools[0].functionDeclarations;
          assertEquals(declarations.length, llmRequest.tools.length);
          for (const [index, tool] of llmRequest.tools.entries()) {
            assertEquals(declarations[index], {
              name: tool.name,
              description: tool.description,
              parametersJsonSchema: tool.parameters,
            });
            assert(!("parameters" in declarations[index]), "legacy proto schema was sent");
          }
          return {
            status: 200,
            headers: {},
            lines: sse([
              'data: {"response":{"candidates":[{"content":{"parts":[{"text":"OK"}]},"finishReason":"STOP"}]}}',
            ]),
          };
        },
      }),
    );
    assertEquals(result, { status: "completed" });
    assertEquals(calls, 1);
    assertEquals(JSON.stringify(llmRequest.tools), originalTools);
  });
}

import type {
  JsonValue,
  NetworkEventStream,
  NetworkResponse,
  PluginContext,
} from "workbuddy-byok:plugin";
import type { LlmRequest, ModelEvent } from "workbuddy-byok:provider";
import type { ResourceSnapshot } from "workbuddy-byok:resource";
import { grokDeviceOAuth } from "./oauth.ts";
import { grokModels, parseGrokModels } from "./models.ts";
import { grokProvider, isQuotaError } from "./provider.ts";
import {
  accountIdentity,
  credentialDraft,
  parseCredentialFiles,
  parseGrokUsage,
  presentAccount,
  quotaState,
  RESOURCE_TYPE,
} from "./resources.ts";

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`expected ${right}, received ${left}`);
}

function jwt(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(
    /\//g,
    "_",
  );
  return `header.${encoded}.signature`;
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
    key: "grok:user-1",
    privateData,
    state: { status: "ready" },
  };
}

async function* sse(lines: string[]): AsyncGenerator<string> {
  for (const line of lines) yield line;
}

function request(): LlmRequest {
  return {
    instructions: "You are a coding assistant.",
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    tools: [],
    reasoning: { enabled: false, effort: null },
    latency: "fast",
    maxOutputTokens: 32_000,
    cacheKey: "conversation-1",
  };
}

Deno.test("account identity uses the JWT subject and drafts keep tokens private-side", async () => {
  const token = jwt({ sub: "user-1", email: "person@x.ai" });
  assertEquals(await accountIdentity(token), {
    key: "grok:user-1",
    displayName: "person@x.ai",
  });
  const draft = await credentialDraft({
    accessToken: token,
    refreshToken: null,
    displayName: null,
  });
  assertEquals(draft.key, "grok:user-1");
  const view = presentAccount(snapshot(draft.privateData));
  assert(!JSON.stringify(view).includes(token), "resource view exposed an access token");
  assertEquals(view.displayName, "person@x.ai");
});

Deno.test("credential import accepts Grok credential JSON files", () => {
  const { credentials, warnings } = parseCredentialFiles([
    {
      name: "accounts.json",
      content: JSON.stringify({
        accounts: [
          { access_token: "token-1", refresh_token: "refresh-1", email: "a@x.ai" },
          { access_token: "token-2", disabled: true },
        ],
      }),
    },
    { name: "broken.json", content: "{not json" },
  ]);
  assertEquals(credentials, [{
    accessToken: "token-1",
    refreshToken: "refresh-1",
    displayName: "a@x.ai",
  }]);
  assertEquals(warnings, ["broken.json: not valid JSON"]);
});

Deno.test("credit usage percent is inverted to remaining and drives cooling", () => {
  const quota = parseGrokUsage({
    config: {
      creditUsagePercent: 34,
      subscriptionTierDisplay: "SuperGrok",
      currentPeriod: { end: "2026-09-01T00:00:00Z" },
    },
  }, 1_700_000_000_000);
  assertEquals(quota.planLabel, "SuperGrok");
  assertEquals(quota.remainingPercent, 66);
  assertEquals(quota.resetAtMs, Date.parse("2026-09-01T00:00:00Z"));
  assertEquals(quotaState(quota, 1_700_000_000_000), { status: "ready" });

  const exhausted = parseGrokUsage({
    config: { creditUsagePercent: 100, currentPeriod: { end: 1_900_000_000 } },
  }, 1_700_000_000_000);
  assertEquals(quotaState(exhausted, 1_700_000_000_000), {
    status: "cooling",
    retryAtMs: 1_900_000_000_000,
    message: "Grok credits are exhausted",
  });
});

Deno.test("missing usage with a billing period counts as unused", () => {
  const quota = parseGrokUsage({ config: { currentPeriod: { end: 1_900_000_000 } } });
  assertEquals(quota.remainingPercent, 100);
  assertEquals(quota.limitReached, false);
});

Deno.test("model discovery parses both language-models and standard list shapes", () => {
  const richModels = parseGrokModels({
    models: [
      { id: "grok-4", input_modalities: ["text", "image"], context_window: 256_000 },
      { id: "grok-3-mini", input_modalities: ["text"] },
      { id: "grok-4" },
    ],
  });
  assertEquals(richModels.map((model) => model.id), ["grok-3-mini", "grok-4"]);
  assertEquals(richModels[1].displayName, "Grok 4");
  assertEquals(richModels[1].capabilities, { images: true, reasoning: false });
  assertEquals(richModels[1].contextWindowTokens, 256000);
  assertEquals(richModels[0].capabilities, { images: false, reasoning: false });

  const plainModels = parseGrokModels({ data: [{ id: "grok-4-fast" }] });
  assertEquals(plainModels.map((model) => model.id), ["grok-4-fast"]);
  assertEquals(plainModels[0].displayName, "Grok 4 Fast");
});

Deno.test("Grok discovery reads dynamic capabilities and removes only declared available aliases", () => {
  const payload = {
    models: [
      {
        id: "grok-10",
        aliases: ["grok-latest"],
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
        context_length: 200000,
        max_output_tokens: 4000,
        capabilities: { reasoning_effort: ["low", "future-depth", "low"] },
      },
      { id: "grok-latest" },
      { id: "grok-2", display_name: "Grok 2" },
      { id: "other-version", display_name: "Grok 2" },
      { id: "image-generator", output_modalities: ["image"] },
    ],
  };
  const models = parseGrokModels(payload);
  assertEquals(models.map((model) => model.id), ["grok-2", "other-version", "grok-10"]);
  assertEquals(models[2].capabilities, { images: true, reasoning: true });
  assertEquals(models[2].reasoningEfforts, ["low", "future-depth"]);
  assertEquals(models[2].contextWindowTokens, 200000);
  assertEquals(models[2].maxOutputTokens, 4000);
  assertEquals(parseGrokModels({ models: [...payload.models].reverse() }), models);
});

Deno.test("Grok discovery keeps ambiguous and cyclic aliases without losing available models", () => {
  const models = parseGrokModels({
    models: [
      { id: "a", aliases: ["shared", "b"] },
      { id: "b", aliases: ["shared", "a"] },
      { id: "shared" },
      { id: "generator", aliases: ["standalone"], output_modalities: ["image"] },
      { id: "standalone" },
    ],
  });
  assertEquals(models.map((model) => model.id), ["a", "b", "shared", "standalone"]);
});

Deno.test("Grok resync replaces models and capabilities and forwards newly discovered efforts", async () => {
  const resource = snapshot({ accessToken: "mock-token" });
  let sync = 0;
  const discovery = context({
    fetch: (url, init) => {
      assertEquals(init?.headers?.authorization, "Bearer mock-token");
      if (url === "https://api.x.ai/v1/models") {
        return { status: 200, headers: {}, body: JSON.stringify({ data: [] }) };
      }
      assertEquals(url, "https://api.x.ai/v1/language-models");
      sync++;
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          models: sync === 1
            ? [
              {
                id: "dynamic",
                input_modalities: ["text", "image"],
                context_length: 1000,
                capabilities: { reasoning_effort: ["old-depth"] },
              },
              { id: "retired" },
            ]
            : [
              {
                id: "dynamic",
                input_modalities: ["text"],
                context_length: 2000,
                capabilities: { reasoning_effort: ["new-depth"] },
              },
              { id: "new-model" },
            ],
        }),
      };
    },
  });
  const before = await grokModels.list({ resource }, discovery);
  const after = await grokModels.list({ resource }, discovery);
  assertEquals(before.map((model) => model.id), ["dynamic", "retired"]);
  assertEquals(after.map((model) => model.id), ["dynamic", "new-model"]);
  assertEquals(after[0].reasoningEfforts, ["new-depth"]);
  assertEquals(after[0].contextWindowTokens, 2000);
  assertEquals(after[0].capabilities?.images, false);
  for (
    const [model, effort, expected] of [
      [before[0], "old-depth", "completed"],
      [after[0], "new-depth", "completed"],
      [after[0], "old-depth", "request-error"],
      [after[0], "none", "request-error"],
      [after[0], null, "completed"],
    ] as const
  ) {
    let calls = 0;
    const result = await grokProvider.invoke(
      {
        model,
        resource,
        request: { ...request(), reasoning: { enabled: effort !== null, effort } },
      },
      { emit: () => {} },
      context({
        stream: (_url, init) => {
          calls++;
          const body = JSON.parse(init?.body ?? "{}");
          assertEquals(body.reasoning_effort, effort ?? undefined);
          assertEquals(body.model, model.id);
          assert(!("service_tier" in body));
          return {
            status: 200,
            headers: {},
            lines: sse(['data: {"choices":[{"delta":{},"finish_reason":"stop"}]}']),
          };
        },
      }),
    );
    assertEquals(result.status, expected);
    assertEquals(calls, expected === "completed" ? 1 : 0);
  }
});

Deno.test("Grok discovery supplements metadata only for available language models", async () => {
  let calls = 0;
  const models = await grokModels.list(
    { resource: snapshot({ accessToken: "mock-token" }) },
    context({
      fetch: (url) => {
        calls++;
        if (url.endsWith("/language-models")) {
          return {
            status: 200,
            headers: {},
            body: JSON.stringify({
              models: [{ id: "dynamic", input_modalities: ["text", "image"] }],
            }),
          };
        }
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            data: [
              {
                id: "dynamic",
                context_length: 200000,
                capabilities: { reasoning_effort: ["future-depth"] },
              },
              { id: "unavailable-language-model", capabilities: { reasoning_effort: ["high"] } },
            ],
          }),
        };
      },
    }),
  );
  assertEquals(calls, 2);
  assertEquals(models.map((model) => model.id), ["dynamic"]);
  assertEquals(models[0].contextWindowTokens, 200000);
  assertEquals(models[0].capabilities, { images: true, reasoning: true });
  assertEquals(models[0].reasoningEfforts, ["future-depth"]);
});

Deno.test("Grok optional metadata failure preserves the language catalog", async () => {
  const models = await grokModels.list(
    { resource: snapshot({ accessToken: "mock-token" }) },
    context({
      fetch: (url) => {
        if (url.endsWith("/language-models")) {
          return {
            status: 200,
            headers: {},
            body: JSON.stringify({
              models: [{ id: "dynamic", capabilities: { reasoning_effort: ["future-depth"] } }],
            }),
          };
        }
        throw new Error("optional metadata unavailable");
      },
    }),
  );
  assertEquals(models.map((model) => model.id), ["dynamic"]);
  assertEquals(models[0].reasoningEfforts, ["future-depth"]);
});

Deno.test("Grok empty discovery fails instead of publishing an empty catalog", async () => {
  const error = await grokModels.list(
    { resource: snapshot({ accessToken: "mock-token" }) },
    context({ fetch: () => ({ status: 200, headers: {}, body: JSON.stringify({ models: [] }) }) }),
  ).then(() => null, (cause: unknown) => cause);
  assert(error instanceof Error && error.message.includes("no supported models"));
});

Deno.test("model discovery reports account errors without inventing models", async () => {
  const token = jwt({ sub: "user-1" });
  const draft = await credentialDraft({
    accessToken: token,
    refreshToken: null,
    displayName: null,
  });
  const error = await grokModels.list(
    { resource: snapshot(draft.privateData) },
    context({
      fetch: () => ({
        status: 403,
        headers: {},
        body: JSON.stringify({ code: "personal-team-blocked:spending-limit" }),
      }),
    }),
  ).then(() => null, (cause: unknown) => cause);
  assert(error instanceof Error && error.message.includes("HTTP 403"));
});

Deno.test("device OAuth begins with a host-held session and completes with a resource draft", async () => {
  const accessToken = jwt({ sub: "user-oauth", email: "oauth@x.ai" });
  let requestNumber = 0;
  const flowContext = context({
    fetch: (url, init) => {
      requestNumber += 1;
      if (requestNumber === 1) {
        assertEquals(url, "https://auth.x.ai/oauth2/device/code");
        assert(init?.body?.includes("scope="), "device code request must carry the scope");
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            device_code: "private-device-code",
            user_code: "ABCD-EFGH",
            verification_uri: "https://accounts.x.ai/activate",
            verification_uri_complete: "https://accounts.x.ai/activate?code=ABCD-EFGH",
            expires_in: 900,
            interval: 5,
          }),
        };
      }
      assertEquals(url, "https://auth.x.ai/oauth2/token");
      assert(init?.body?.includes("device_code=private-device-code"));
      if (requestNumber === 2) {
        return {
          status: 400,
          headers: {},
          body: JSON.stringify({ error: "authorization_pending" }),
        };
      }
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ access_token: accessToken, refresh_token: "refresh-secret" }),
      };
    },
  });

  const begun = await grokDeviceOAuth.begin(flowContext);
  assertEquals(begun.userCode, "ABCD-EFGH");
  assertEquals(begun.pollIntervalMs, 5000);

  const pending = await grokDeviceOAuth.poll(begun.session, flowContext);
  assertEquals(pending.status, "pending");

  const polled = await grokDeviceOAuth.poll(begun.session, flowContext);
  assert(polled.status === "completed", `expected completed, received ${polled.status}`);
  assertEquals(polled.resources[0].key, "grok:user-oauth");
  assertEquals(requestNumber, 3);
});

Deno.test("invoke streams normalized events from the xAI Chat Completions API", async () => {
  const token = jwt({ sub: "user-1" });
  const draft = await credentialDraft({
    accessToken: token,
    refreshToken: null,
    displayName: null,
  });
  let requestBody = "";
  let requestHeaders: Record<string, string> = {};
  const events: ModelEvent[] = [];
  const result = await grokProvider.invoke(
    {
      model: { id: "grok-4", displayName: "Grok 4" },
      resource: snapshot(draft.privateData),
      request: request(),
    },
    { emit: (event) => events.push(event) },
    context({
      stream: (url, init) => {
        assertEquals(url, "https://api.x.ai/v1/chat/completions");
        requestBody = init?.body ?? "";
        requestHeaders = init?.headers ?? {};
        return {
          status: 200,
          headers: {},
          lines: sse([
            'data: {"choices":[{"delta":{"content":"Hel"}}]}',
            'data: {"choices":[{"delta":{"content":"lo"}}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":4}}}',
            "data: [DONE]",
          ]),
        };
      },
    }),
  );
  assertEquals(result, { status: "completed" });
  const body = JSON.parse(requestBody) as Record<string, unknown>;
  assertEquals(body.model, "grok-4");
  assertEquals(body.stream, true);
  assertEquals(body.prompt_cache_key, "conversation-1");
  assert(!("reasoning_effort" in body), "default request must leave reasoning effort to upstream");
  assert(!("service_tier" in body), "xAI endpoint rejects service_tier");
  assertEquals(requestHeaders["authorization"], `Bearer ${token}`);
  assertEquals(events, [
    { type: "text-start" },
    { type: "text-delta", text: "Hel" },
    { type: "text-delta", text: "lo" },
    { type: "text-end" },
    {
      type: "usage",
      usage: {
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: null,
        cacheReadTokens: 4,
        cacheWriteTokens: null,
        reasoningTokens: null,
      },
    },
    { type: "done", reason: "stop" },
  ]);
});

Deno.test("invoke streams incremental tool calls and reasoning replay state", async () => {
  const token = jwt({ sub: "user-1" });
  const draft = await credentialDraft({
    accessToken: token,
    refreshToken: null,
    displayName: null,
  });
  const events: ModelEvent[] = [];
  const result = await grokProvider.invoke(
    {
      model: { id: "grok-4", displayName: "Grok 4" },
      resource: snapshot(draft.privateData),
      request: request(),
    },
    { emit: (event) => events.push(event) },
    context({
      stream: () => ({
        status: 200,
        headers: {},
        lines: sse([
          'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.ts\\"}"}}]}}]}',
          'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
          "data: [DONE]",
        ]),
      }),
    }),
  );
  assertEquals(result, { status: "completed" });
  assertEquals(events, [
    { type: "thinking-start" },
    { type: "thinking-delta", text: "thinking" },
    { type: "tool-call-start", index: 0, callId: "call-1", name: "read_file" },
    { type: "tool-call-arguments-delta", index: 0, delta: '{"path":' },
    { type: "tool-call-arguments-delta", index: 0, delta: '"a.ts"}' },
    { type: "thinking-end" },
    { type: "tool-call-end", index: 0 },
    {
      type: "replay-state",
      providerKind: "openai_chat",
      value: { reasoning_content: "thinking" },
    },
    { type: "done", reason: "tool-use" },
  ]);
});

Deno.test("invoke maps quota failures to a cooling resource error", async () => {
  assert(!isQuotaError("400 invalid request"));
  assert(isQuotaError("429 credits exhausted"));
  const token = jwt({ sub: "user-1" });
  const draft = await credentialDraft({
    accessToken: token,
    refreshToken: null,
    displayName: null,
  });
  const result = await grokProvider.invoke(
    {
      model: { id: "grok-4", displayName: "Grok 4" },
      resource: snapshot(draft.privateData),
      request: request(),
    },
    { emit: () => {} },
    context({
      stream: () => ({
        status: 429,
        headers: {},
        lines: sse(['{"error":"credits exhausted"}']),
      }),
    }),
  );
  assert(result.status === "resource-error", `expected resource-error, received ${result.status}`);
  assert(result.patch.state?.status === "cooling", "quota failure should cool the resource");
});

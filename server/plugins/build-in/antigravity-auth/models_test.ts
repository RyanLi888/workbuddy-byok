import { antigravityModels, parseAntigravityModels, resolveAntigravityModel } from "./models.ts";
import type { NetworkResponse, PluginContext } from "workbuddy-byok:plugin";
import type { ResourceSnapshot } from "workbuddy-byok:resource";

Deno.test("Google discovery exposes only returned models and their capabilities", () => {
  const models = parseAntigravityModels({
    models: {
      "gemini-account-model": {
        displayName: "Account model",
        supportsImages: true,
        supportsThinking: true,
        maxInputTokens: 123456,
        maxOutputTokens: 2000,
      },
    },
  });
  if (models.length !== 1 || models[0].id !== "gemini-account-model") {
    throw new Error("invented model entries");
  }
  if (!models[0].capabilities?.reasoning || models[0].contextWindowTokens !== 123456) {
    throw new Error("lost capabilities");
  }
  if (models[0].reasoningEfforts?.length) throw new Error("invented reasoning strengths");
  if (parseAntigravityModels({}).length !== 0) throw new Error("invalid discovery was accepted");
});

Deno.test("Google discovery groups strengths and aliases without inventing upstream IDs", () => {
  const models = {
    "chat-alias": { displayName: "Gemini 3.1 Pro (High)", supportsThinking: true },
    "gemini-3.1-pro-low": { displayName: "Gemini 3.1 Pro (Low)", supportsThinking: true },
    "gemini-3.1-pro-high": { displayName: "Gemini 3.1 Pro (High)", supportsThinking: true },
    "gemini-3.1-pro-medium": { displayName: "Gemini 3.1 Pro (Medium)", supportsThinking: true },
    "chat_20706": { displayName: "Internal model" },
  };
  const grouped = parseAntigravityModels({ models });
  if (grouped.length !== 1) throw new Error("strengths or aliases were not merged");
  const model = grouped[0];
  if (model.displayName !== "Gemini 3.1 Pro" || model.id !== "gemini-3.1-pro-medium") {
    throw new Error("wrong representative");
  }
  if (JSON.stringify(model.reasoningEfforts) !== JSON.stringify(["low", "medium", "high"])) {
    throw new Error("wrong strengths");
  }
  for (const effort of model.reasoningEfforts!) {
    const upstream = resolveAntigravityModel(model, effort);
    if (upstream !== `gemini-3.1-pro-${effort}` || !(upstream in models)) {
      throw new Error("invented or incorrect route");
    }
  }
  if (resolveAntigravityModel(model, null) !== model.id) throw new Error("default route changed");
  const reversed = parseAntigravityModels({
    models: Object.fromEntries(Object.entries(models).reverse()),
  });
  if (JSON.stringify(grouped) !== JSON.stringify(reversed)) {
    throw new Error("upstream order changes catalog");
  }
});

Deno.test("Google discovery keeps versions and model types separate and sorts naturally", () => {
  const models = parseAntigravityModels({
    models: {
      ten: { displayName: "Gemini 10 Flash" },
      image: { displayName: "Gemini 3.1 Flash Image" },
      lite: { displayName: "Gemini 3.1 Flash Lite" },
      pro: { displayName: "Gemini 3.1 Pro" },
      flash: { displayName: "Gemini 3.1 Flash" },
      newer: { displayName: "Gemini 3.5 Flash" },
    },
  });
  const names = models.map((model) => model.displayName);
  const expected = [
    "Gemini 3.1 Flash",
    "Gemini 3.1 Flash Image",
    "Gemini 3.1 Flash Lite",
    "Gemini 3.1 Pro",
    "Gemini 3.5 Flash",
    "Gemini 10 Flash",
  ];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error("merged distinct models or failed to sort");
  }
  if (models.some((model) => model.reasoningEfforts?.length)) throw new Error("invented strengths");
});

Deno.test("Google discovery deduplicates normalized names and prefers named IDs", () => {
  const models = parseAntigravityModels({
    models: {
      opaque: { displayName: "  GEMINI  3.1 Pro  ", supportsThinking: true },
      "gemini-3.1-pro": { displayName: "Gemini 3.1 Pro", supportsThinking: true },
      "gemini-3.1-pro-high": { displayName: "Gemini 3.1 Pro High", supportsThinking: true },
    },
  });
  if (
    models.length !== 1 || models[0].id !== "gemini-3.1-pro" ||
    models[0].displayName !== "Gemini 3.1 Pro"
  ) throw new Error("duplicate names remain");
  if (resolveAntigravityModel(models[0], "high") !== "gemini-3.1-pro-high") {
    throw new Error("lost high route");
  }
});

Deno.test("Google discovery recognizes ID strengths and publishes conservative shared capabilities", () => {
  const models = parseAntigravityModels({
    models: {
      "gemini-flash-low": {
        displayName: "Gemini Flash",
        supportsThinking: true,
        supportsImages: true,
        maxInputTokens: 200000,
        maxOutputTokens: 8000,
      },
      "gemini-flash-high": {
        displayName: "Gemini Flash",
        supportsThinking: true,
        supportsImages: false,
        maxInputTokens: 100000,
        maxOutputTokens: 4000,
      },
    },
  });
  const model = models[0];
  if (models.length !== 1 || model.capabilities?.images || !model.capabilities?.reasoning) {
    throw new Error("overstated capabilities");
  }
  if (model.maxOutputTokens !== 4000 || model.contextWindowTokens !== 100000) {
    throw new Error("overstated token limits");
  }
  if (JSON.stringify(model.reasoningEfforts) !== JSON.stringify(["low", "high"])) {
    throw new Error("invented medium strength");
  }
  let rejected = false;
  try {
    resolveAntigravityModel(model, "medium");
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("unsupported strength silently substituted");
});

const resource: ResourceSnapshot = {
  id: "test",
  type: "antigravity-account",
  key: "test",
  state: { status: "ready" },
  privateData: { accessToken: "test-token", projectId: "test-project" },
};

function context(fetch: PluginContext["network"]["fetch"]): PluginContext {
  return {
    network: {
      fetch,
      stream: () => {
        throw new Error("unexpected stream");
      },
    },
    signal: new AbortController().signal,
  };
}

function response(status: number, body: unknown): NetworkResponse {
  return { status, headers: {}, body: JSON.stringify(body) };
}

Deno.test("Google discovery sends the account project and uses the available endpoint", async () => {
  let calls = 0;
  const models = await antigravityModels.list(
    { resource },
    context((_url, init) => {
      calls++;
      if (JSON.parse(init?.body ?? "{}").project !== "test-project") {
        throw new Error("missing project");
      }
      if (init?.headers?.authorization !== "Bearer test-token") throw new Error("missing token");
      return Promise.resolve(
        calls === 1
          ? response(503, {})
          : response(200, { models: { real: { supportsThinking: true } } }),
      );
    }),
  );
  if (calls !== 2 || models[0].id !== "real") throw new Error("discovery failed");
});

Deno.test("Google discovery reports expired authorization without repeating the same token", async () => {
  let calls = 0;
  try {
    await antigravityModels.list(
      { resource },
      context(() => {
        calls++;
        return Promise.resolve(response(401, { error: { message: "private upstream text" } }));
      }),
    );
    throw new Error("expected rejection");
  } catch (error) {
    const message = String(error);
    if (
      !message.includes("HTTP 401") || !message.includes("refresh or sign in again") ||
      message.includes("private upstream text")
    ) throw error;
  }
  if (calls !== 1) throw new Error("repeated expired authorization");
});

Deno.test("Google discovery distinguishes unavailable endpoints and empty model responses", async () => {
  let calls = 0;
  try {
    await antigravityModels.list(
      { resource },
      context(() => {
        calls++;
        if (calls === 1) throw new Error("private network detail");
        return Promise.resolve(calls === 2 ? response(403, {}) : response(200, { models: {} }));
      }),
    );
    throw new Error("expected rejection");
  } catch (error) {
    const message = String(error);
    if (
      !message.includes("network request failed") || !message.includes("HTTP 403") ||
      !message.includes("no models returned") || message.includes("private network detail")
    ) throw error;
  }
});

Deno.test("Google model discovery requires an account", async () => {
  let rejected = false;
  try {
    await antigravityModels.list({ resource: null }, {} as PluginContext);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("unauthenticated model catalog was advertised");
});

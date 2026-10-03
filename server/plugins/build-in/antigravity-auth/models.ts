import type { NetworkResponse } from "workbuddy-byok:plugin";
import type { ModelDefinition, ModelSnapshot, ModelSupport } from "workbuddy-byok:model";
import { accountData } from "./resources.ts";

export const ANTIGRAVITY_PROD_ENDPOINT = "https://cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_DAILY_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_SANDBOX_ENDPOINT = "https://daily-cloudcode-pa.sandbox.googleapis.com";

export const ANTIGRAVITY_ENDPOINTS = [
  ANTIGRAVITY_DAILY_ENDPOINT,
  ANTIGRAVITY_PROD_ENDPOINT,
  ANTIGRAVITY_SANDBOX_ENDPOINT,
];

const FETCH_AVAILABLE_MODELS_PATH = "/v1internal:fetchAvailableModels";
export const ANTIGRAVITY_USER_AGENT =
  "antigravity/hub/2.12.2 (aidev_client; os_type=darwin; arch=arm64; cl=975423596)";

export const ANTIGRAVITY_CLIENT_HEADERS: Record<string, string> = {};

const ANTIGRAVITY_DENYLIST = new Set(["chat_20706", "chat_23310"]);

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const EFFORT_SUFFIX =
  /(?:\s*\((none|minimal|low|medium|high|xhigh|max)\)|[\s_-]+(none|minimal|low|medium|high|xhigh|max))$/i;

type ModelVariant = { model: ModelDefinition; effort: string | null };

function modelName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function compareVariants(left: ModelVariant, right: ModelVariant): number {
  const rank = ({ model, effort }: ModelVariant) => {
    // Prefer the upstream's named model over an opaque alias, then its default/medium variant.
    const named =
      modelName(model.id) === modelName(model.displayName) + (effort ? `-${effort}` : "");
    const preferred = [null, "medium", "high", "low", "minimal", "xhigh", "max", "none"].indexOf(
      effort,
    );
    return (named ? 0 : 10) + preferred;
  };
  return rank(left) - rank(right) || left.model.id.localeCompare(right.model.id);
}

function minimumLimit(
  variants: ModelVariant[],
  field: "maxOutputTokens" | "contextWindowTokens",
): number | undefined {
  const limits = variants.map(({ model }) => model[field]);
  return limits.every((limit) => limit !== undefined) ? Math.min(...limits as number[]) : undefined;
}

export function parseAntigravityModels(payload: unknown): ModelDefinition[] {
  const root = object(payload);
  const rawModels = object(root?.models);
  if (!rawModels) return [];

  const groups = new Map<string, ModelVariant[]>();
  const seen = new Set<string>();

  for (const [modelId, raw] of Object.entries(rawModels)) {
    const model = object(raw);
    if (!model) continue;

    const id = modelId.trim();
    if (!id || seen.has(id) || ANTIGRAVITY_DENYLIST.has(id)) continue;
    seen.add(id);

    const rawName = text(model.displayName) ?? id;
    const nameSuffix = rawName.match(EFFORT_SUFFIX);
    const idSuffix = id.match(/[-_](none|minimal|low|medium|high|xhigh|max)$/i);
    const effort = (nameSuffix?.[1] ?? nameSuffix?.[2] ?? idSuffix?.[1])?.toLowerCase() ?? null;
    const displayName = (nameSuffix ? rawName.slice(0, nameSuffix.index).trim() : rawName)
      .replace(/\s+/g, " ");
    if (!displayName) continue;
    const supportsThinking = model.supportsThinking === true;
    const maxOutputTokens = typeof model.maxOutputTokens === "number" && model.maxOutputTokens > 0
      ? model.maxOutputTokens
      : undefined;

    const definition: ModelDefinition = {
      id,
      displayName,
      capabilities: {
        images: model.supportsImages === true,
        reasoning: supportsThinking,
      },
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      ...(typeof model.maxInputTokens === "number" && model.maxInputTokens > 0
        ? { contextWindowTokens: model.maxInputTokens }
        : {}),
    };
    const key = displayName.toLowerCase();
    const variants = groups.get(key) ?? [];
    variants.push({ model: definition, effort });
    groups.set(key, variants);
  }

  return [...groups.values()].map((variants): ModelDefinition => {
    variants.sort(compareVariants);
    const representative = variants[0].model;
    const effortModels: Record<string, string> = {};
    for (const { model, effort } of variants) {
      if (effort && !effortModels[effort]) effortModels[effort] = model.id;
    }
    const efforts = REASONING_EFFORTS.filter((effort) => effortModels[effort]);
    const maxOutputTokens = minimumLimit(variants, "maxOutputTokens");
    const contextWindowTokens = minimumLimit(variants, "contextWindowTokens");
    return {
      id: representative.id,
      displayName: representative.displayName,
      capabilities: {
        images: variants.every(({ model }) => model.capabilities?.images === true),
        reasoning: efforts.some((effort) => effort !== "none") ||
          variants.some(({ model }) => model.capabilities?.reasoning === true),
      },
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
      ...(efforts.length ? { reasoningEfforts: efforts, privateData: { effortModels } } : {}),
    };
  }).sort((left, right) =>
    left.displayName.localeCompare(right.displayName, "en", { numeric: true })
  );
}

export function resolveAntigravityModel(model: ModelSnapshot, effort: string | null): string {
  const effortModels = object(object(model.privateData)?.effortModels);
  if (!effortModels || effort === null) return model.id;
  const upstreamId = text(effortModels[effort]);
  if (!upstreamId) {
    throw new Error(`Model ${model.displayName} does not support reasoning effort '${effort}'`);
  }
  return upstreamId;
}

export const antigravityModels: ModelSupport = {
  list: async ({ resource }, context): Promise<ModelDefinition[]> => {
    if (!resource) throw new Error("add a Google account before syncing Gemini models");
    const data = accountData(resource);

    const failures: string[] = [];
    for (const endpoint of ANTIGRAVITY_ENDPOINTS) {
      const host = new URL(endpoint).hostname;
      let response: NetworkResponse;
      try {
        response = await context.network.fetch(
          `${endpoint}${FETCH_AVAILABLE_MODELS_PATH}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${data.accessToken}`,
              "content-type": "application/json",
              "user-agent": ANTIGRAVITY_USER_AGENT,
              ...ANTIGRAVITY_CLIENT_HEADERS,
            },
            body: JSON.stringify({ project: data.projectId }),
          },
        );
      } catch {
        failures.push(`${host}: network request failed`);
        continue;
      }
      if (response.status === 401) {
        throw new Error(
          "Google model discovery failed: HTTP 401; account authorization expired, refresh or sign in again",
        );
      }
      if (response.status < 200 || response.status >= 300) {
        failures.push(`${host}: HTTP ${response.status}`);
        continue;
      }
      try {
        const models = parseAntigravityModels(JSON.parse(response.body));
        if (models.length > 0) return models;
        failures.push(`${host}: no models returned`);
      } catch {
        failures.push(`${host}: invalid model response`);
      }
    }
    throw new Error(`Google model discovery failed: ${failures.join("; ")}`);
  },
};

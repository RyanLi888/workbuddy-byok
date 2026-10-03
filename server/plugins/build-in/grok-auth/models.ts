import type { ModelDefinition, ModelSupport } from "workbuddy-byok:model";
import { accountData } from "./resources.ts";

const LANGUAGE_MODELS_URL = "https://api.x.ai/v1/language-models";
const MODELS_URL = "https://api.x.ai/v1/models";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function modalities(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => (typeof item === "string" ? [item.toLowerCase()] : []))
    : [];
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : undefined;
}

function reasoningEfforts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.flatMap((entry) => {
      const effort = text(typeof entry === "string" ? entry : object(entry)?.effort);
      return effort ? [effort] : [];
    })),
  ];
}

/** 把模型 ID 变成可读名称,如 grok-4-fast → Grok 4 Fast。 */
function displayName(id: string): string {
  return id
    .split("-")
    .map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

/** 兼容 /v1/language-models 的 models 数组与 /v1/models 的 data 数组。 */
function modelEntries(body: unknown): unknown[] {
  const root = object(body);
  const source = root?.models ?? root?.data ?? body;
  if (!Array.isArray(source)) {
    throw new Error("Grok model discovery response does not contain a model list");
  }
  return source;
}

export function parseGrokModels(body: unknown): ModelDefinition[] {
  const source = modelEntries(body);
  const seen = new Set<string>();
  const models: ModelDefinition[] = [];
  const aliasOwners = new Map<string, Set<string>>();
  for (const raw of source) {
    const model = object(raw);
    const id = text(model?.id ?? model?.name);
    if (!id || !Array.isArray(model?.aliases)) continue;
    for (const value of model.aliases) {
      const alias = text(value);
      if (!alias || alias === id) continue;
      const owners = aliasOwners.get(alias) ?? new Set<string>();
      owners.add(id);
      aliasOwners.set(alias, owners);
    }
  }
  for (const raw of source) {
    const model = object(raw);
    const id = model ? text(model.id ?? model.name) : null;
    if (!model || !id || seen.has(id)) continue;
    seen.add(id);
    const outputs = modalities(model.output_modalities ?? model.outputModalities);
    if (outputs.length > 0 && !outputs.includes("text")) continue;
    const inputs = modalities(model?.input_modalities ?? model?.inputModalities);
    const capabilities = object(model.capabilities);
    const efforts = reasoningEfforts(capabilities?.reasoning_effort);
    const contextWindowTokens = positiveInteger(model.context_length ?? model.context_window);
    const maxOutputTokens = positiveInteger(model.max_output_tokens);
    const description = text(model.description);
    models.push({
      id,
      displayName: text(model.display_name ?? model.displayName) ?? displayName(id),
      ...(description ? { description } : {}),
      ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      capabilities: {
        images: inputs.includes("image"),
        reasoning: efforts.some((effort) => effort !== "none"),
      },
      reasoningEfforts: efforts,
    });
  }
  const availableIds = new Set(models.map((model) => model.id));
  return models.filter((model) => {
    const owners = aliasOwners.get(model.id);
    if (owners?.size !== 1) return true;
    const owner = [...owners][0];
    // Only collapse explicitly declared aliases when their canonical model is available.
    // Conflicting/cyclic alias declarations remain independent models.
    return !availableIds.has(owner) || aliasOwners.has(owner);
  }).sort((left, right) =>
    left.displayName.localeCompare(right.displayName, "en", { numeric: true }) ||
    left.id.localeCompare(right.id)
  );
}

export const grokModels: ModelSupport = {
  list: async ({ resource }, context): Promise<ModelDefinition[]> => {
    if (!resource) throw new Error("add a Grok account before syncing models");
    const data = accountData(resource);
    const headers = {
      accept: "application/json",
      authorization: `Bearer ${data.accessToken}`,
    };
    // The language catalog owns available text models and modalities.
    // The standard catalog can supplement token limits and reasoning capabilities.
    let response = await context.network.fetch(LANGUAGE_MODELS_URL, { method: "GET", headers });
    const hasLanguageCatalog = response.status >= 200 && response.status < 300;
    if (!hasLanguageCatalog) {
      response = await context.network.fetch(MODELS_URL, { method: "GET", headers });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Grok model discovery failed (HTTP ${response.status}): ${response.body}`);
    }
    let body: unknown;
    try {
      body = JSON.parse(response.body);
    } catch {
      throw new Error("Grok model discovery returned invalid JSON");
    }
    const entries = modelEntries(body);
    if (hasLanguageCatalog) {
      let metadata: unknown[] = [];
      try {
        const details = await context.network.fetch(MODELS_URL, { method: "GET", headers });
        if (details.status >= 200 && details.status < 300) {
          metadata = modelEntries(JSON.parse(details.body));
        }
      } catch {
        // Optional metadata must not discard a valid account model list.
      }
      const byId = new Map(metadata.flatMap((raw): [string, Record<string, unknown>][] => {
        const model = object(raw);
        const id = text(model?.id ?? model?.name);
        return model && id ? [[id, model]] : [];
      }));
      body = {
        models: entries.map((raw) => {
          const model = object(raw);
          const id = text(model?.id ?? model?.name);
          const details = id ? byId.get(id) : undefined;
          if (!model || !details) return raw;
          return {
            ...details,
            ...model,
            capabilities: { ...object(details.capabilities), ...object(model.capabilities) },
          };
        }),
      };
    }
    const models = parseGrokModels(body);
    if (models.length === 0) throw new Error("Grok model discovery returned no supported models");
    return models;
  },
};

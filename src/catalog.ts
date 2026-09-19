import { isRecord } from "./auth.ts";

/** Base URL of Command Code's official Provider API. */
export const DEFAULT_BASE_URL = "https://api.commandcode.ai/provider/v1";

/** Endpoint every model must serve for this OpenAI-compatible provider. */
export const CHAT_COMPLETIONS_ENDPOINT = "/chat/completions";

const DEFAULT_CONTEXT_LENGTH = 128_000;
const DEFAULT_OUTPUT_LIMIT = 32_000;
const DEFAULT_TIMEOUT_MS = 8_000;

/** One entry from `GET /provider/v1/models`. */
export interface CommandCodeModel {
  readonly id: string;
  readonly name: string | undefined;
  readonly contextLength: number | undefined;
  readonly supportedEndpoints: readonly string[];
}

/** One model as OpenCode's provider config expects it. */
export interface OpencodeProviderModel {
  readonly id: string;
  readonly name: string;
  readonly reasoning: boolean;
  readonly tool_call: boolean;
  readonly cost: { readonly input: number; readonly output: number };
  readonly limit: { readonly context: number; readonly output: number };
}

/** Parses the Provider API models payload, ignoring unusable entries. */
export const parseModels = (payload: unknown): CommandCodeModel[] => {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return [];
  }
  const models: CommandCodeModel[] = [];
  for (const entry of payload.data) {
    if (!isRecord(entry)) {
      continue;
    }
    const { id } = entry;
    if (typeof id !== "string" || id === "") {
      continue;
    }
    models.push({
      id,
      name: typeof entry.name === "string" ? entry.name : undefined,
      contextLength:
        typeof entry.context_length === "number" && entry.context_length > 0
          ? entry.context_length
          : undefined,
      supportedEndpoints: Array.isArray(entry.supported_endpoints)
        ? entry.supported_endpoints.filter(
            (endpoint): endpoint is string => typeof endpoint === "string"
          )
        : [],
    });
  }
  return models;
};

/** Whether a model is served over the OpenAI-compatible endpoint. */
export const supportsChatCompletions = (model: CommandCodeModel): boolean =>
  model.supportedEndpoints.includes(CHAT_COMPLETIONS_ENDPOINT);

/** Parses a previously cached model array, returning an empty list on garbage. */
export const parseCachedModels = (value: unknown): CommandCodeModel[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const models: CommandCodeModel[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const { id } = entry;
    if (typeof id !== "string" || id === "") {
      continue;
    }
    models.push({
      id,
      name: typeof entry.name === "string" ? entry.name : undefined,
      contextLength:
        typeof entry.contextLength === "number" && entry.contextLength > 0
          ? entry.contextLength
          : undefined,
      supportedEndpoints: Array.isArray(entry.supportedEndpoints)
        ? entry.supportedEndpoints.filter(
            (endpoint): endpoint is string => typeof endpoint === "string"
          )
        : [],
    });
  }
  return models;
};

/**
 * Maps the live catalog to OpenCode model config.
 *
 * Claude models are `/messages`-only, so they are excluded from this
 * OpenAI-compatible provider and should be configured separately.
 */
export const toOpencodeModels = (
  models: readonly CommandCodeModel[]
): Record<string, OpencodeProviderModel> => {
  const result: Record<string, OpencodeProviderModel> = {};
  for (const model of models) {
    if (!supportsChatCompletions(model)) {
      continue;
    }
    result[model.id] = {
      id: model.id,
      name: model.name ?? model.id,
      reasoning: true,
      tool_call: true,
      cost: { input: 0, output: 0 },
      limit: {
        context: model.contextLength ?? DEFAULT_CONTEXT_LENGTH,
        output: DEFAULT_OUTPUT_LIMIT,
      },
    };
  }
  return result;
};

/** Options for {@link fetchCatalog}. */
export interface FetchCatalogOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: FetchLike;
}

/** Minimal fetch signature used by the catalog client. */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

/**
 * Fetches the live model catalog from the official Provider API.
 *
 * Returns `null` on any transport, auth, or decode failure so callers can fall
 * back to a cached catalog instead of failing plugin startup.
 */
export const fetchCatalog = async ({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
}: FetchCatalogOptions): Promise<CommandCodeModel[] | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/models`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    return parseModels(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

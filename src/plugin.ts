import type { AuthHook, Plugin } from "@opencode-ai/plugin";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { API_KEY_ENV, PROVIDER_ID, resolveApiKey } from "./auth.ts";
import {
  DEFAULT_BASE_URL,
  fetchCatalog,
  parseCachedModels,
  toOpencodeModels,
  type CommandCodeModel,
} from "./catalog.ts";

const cacheFile = (): string =>
  join(
    process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
    "opencode",
    "commandcode-models.json"
  );

type ProviderEntry = Record<string, unknown>;

type MutableConfig = {
  provider?: Record<string, ProviderEntry>;
};

const toRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const readCache = (): CommandCodeModel[] | null => {
  try {
    const models = parseCachedModels(
      JSON.parse(readFileSync(cacheFile(), "utf-8"))
    );
    return models.length > 0 ? models : null;
  } catch {
    return null;
  }
};

const writeCache = (models: readonly CommandCodeModel[]): void => {
  try {
    mkdirSync(dirname(cacheFile()), { recursive: true });
    writeFileSync(cacheFile(), JSON.stringify(models));
  } catch {
    // A missing cache only costs one extra live fetch on the next startup.
  }
};

/**
 * Registers Command Code as an OpenCode provider using the official Provider
 * API. The live model catalog is fetched on every startup and cached, so new
 * models appear without any manual sync.
 */
export const CommandCodePlugin: Plugin = async () => {
  const auth: AuthHook = {
    provider: PROVIDER_ID,
    methods: [
      {
        type: "api",
        label: "API Key",
        authorize: async (inputs) => {
          const key = inputs?.key;
          if (typeof key !== "string" || key.trim() === "") {
            return { type: "failed" as const };
          }
          return { type: "success" as const, key: key.trim() };
        },
      },
    ],
    loader: async (getAuth) => {
      try {
        const auth = (await getAuth()) as unknown as {
          type?: string;
          key?: string;
        };
        if (auth.type === "api" && typeof auth.key === "string") {
          return { apiKey: auth.key };
        }
      } catch {
        // Fall through to an empty result when auth cannot be read.
      }
      return {};
    },
  };

  return {
    auth,
    config: async (input) => {
      const config = input as unknown as MutableConfig;
      const providers = (config.provider ??= {});
      const existing = toRecord(providers[PROVIDER_ID]);
      const existingOptions = toRecord(existing.options);
      const baseURL =
        typeof existingOptions.baseURL === "string"
          ? existingOptions.baseURL
          : DEFAULT_BASE_URL;

      const apiKey = resolveApiKey();
      let models = apiKey
        ? await fetchCatalog({ apiKey, baseUrl: baseURL })
        : null;
      if (models && models.length > 0) {
        writeCache(models);
      } else {
        models = readCache();
      }

      providers[PROVIDER_ID] = {
        ...existing,
        npm: existing.npm ?? "@ai-sdk/openai-compatible",
        name: existing.name ?? "Command Code",
        env: existing.env ?? [API_KEY_ENV],
        options: { baseURL, ...existingOptions },
        models: {
          ...toOpencodeModels(models ?? []),
          ...toRecord(existing.models),
        },
      };
    },
  };
};

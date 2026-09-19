import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** OpenCode provider id this plugin registers. */
export const PROVIDER_ID = "commandcode";

/** Environment variable consulted for the API key. */
export const API_KEY_ENV = "COMMANDCODE_API_KEY";

/** Returns true for a non-null, non-array object. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads and parses a JSON file, returning null when absent or invalid. */
export const readJsonFile = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
};

/**
 * Extracts an API key from a supported auth shape.
 *
 * Accepts a direct `{ key }` / `{ apiKey }` object and the nested
 * `{ commandcode: { key } }` shape used by OpenCode's auth store.
 */
export const keyFromAuth = (value: unknown): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const directKey = value.key;
  if (typeof directKey === "string" && directKey.trim() !== "") {
    return directKey.trim();
  }
  const directApiKey = value.apiKey;
  if (typeof directApiKey === "string" && directApiKey.trim() !== "") {
    return directApiKey.trim();
  }
  const nested = value[PROVIDER_ID];
  if (isRecord(nested)) {
    return keyFromAuth(nested);
  }
  return undefined;
};

/** Resolves OpenCode's per-user data directory. */
export const opencodeDataDir = (env: NodeJS.ProcessEnv = process.env): string =>
  env.XDG_DATA_HOME
    ? join(env.XDG_DATA_HOME, "opencode")
    : join(homedir(), ".local", "share", "opencode");

/**
 * Resolves the Command Code API key.
 *
 * Order: the environment variable, OpenCode's auth store, then the Command
 * Code CLI auth file. The same key authenticates the CLI and the Provider API.
 */
export const resolveApiKey = (
  env: NodeJS.ProcessEnv = process.env
): string | undefined => {
  const fromEnv = env[API_KEY_ENV];
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") {
    return fromEnv.trim();
  }
  const fromOpenCode = keyFromAuth(
    readJsonFile(join(opencodeDataDir(env), "auth.json"))
  );
  if (fromOpenCode) {
    return fromOpenCode;
  }
  return keyFromAuth(
    readJsonFile(join(homedir(), ".commandcode", "auth.json"))
  );
};

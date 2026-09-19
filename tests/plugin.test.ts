import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Config } from "@opencode-ai/plugin";

import { CommandCodePlugin } from "../index.ts";

const originalFetch = globalThis.fetch;
let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "cc-provider-"));
  process.env.XDG_CACHE_HOME = cacheDir;
  process.env.COMMANDCODE_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.XDG_CACHE_HOME;
  delete process.env.COMMANDCODE_API_KEY;
  rmSync(cacheDir, { force: true, recursive: true });
});

const catalogFetch = (data: unknown): typeof fetch =>
  (async () => Response.json({ data })) as unknown as typeof fetch;

const runConfig = async (initial: Record<string, unknown> = {}) => {
  const hooks = await CommandCodePlugin({} as never);
  const config = { provider: initial } as unknown as Config;
  await hooks.config?.(config);
  return config as unknown as {
    provider: Record<string, Record<string, unknown>>;
  };
};

describe("CommandCodePlugin config", () => {
  test("injects the provider on the official API with live models", async () => {
    globalThis.fetch = catalogFetch([
      {
        context_length: 1_000_000,
        id: "deepseek/x",
        name: "DeepSeek",
        supported_endpoints: ["/chat/completions"],
      },
      { id: "claude/y", supported_endpoints: ["/messages"] },
    ]);

    const config = await runConfig();
    const provider = config.provider.commandcode;

    expect(provider?.npm).toBe("@ai-sdk/openai-compatible");
    expect((provider?.options as Record<string, unknown>).baseURL).toBe(
      "https://api.commandcode.ai/provider/v1"
    );
    expect(Object.keys(provider?.models as object)).toEqual(["deepseek/x"]);
  });

  test("preserves existing provider fields and models", async () => {
    globalThis.fetch = catalogFetch([]);

    const config = await runConfig({
      commandcode: { models: { keep: { id: "keep" } }, npm: "custom" },
    });
    const provider = config.provider.commandcode;

    expect(provider?.npm).toBe("custom");
    expect((provider?.models as Record<string, unknown>).keep).toEqual({
      id: "keep",
    });
  });

  test("falls back to the cached catalog when the fetch fails", async () => {
    globalThis.fetch = catalogFetch([
      {
        id: "deepseek/x",
        name: "DeepSeek",
        supported_endpoints: ["/chat/completions"],
      },
    ]);
    await runConfig();

    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const config = await runConfig();

    expect(
      Object.keys(config.provider.commandcode?.models as object)
    ).toEqual(["deepseek/x"]);
  });
});

describe("CommandCodePlugin auth", () => {
  test("returns the stored key from the auth loader", async () => {
    const hooks = await CommandCodePlugin({} as never);
    const result = await hooks.auth?.loader?.(
      (async () => ({ key: "abc", type: "api" })) as never,
      {} as never
    );

    expect(result).toEqual({ apiKey: "abc" });
  });
});

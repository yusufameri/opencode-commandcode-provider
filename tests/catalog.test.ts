import { describe, expect, test } from "bun:test";

import {
  fetchCatalog,
  parseCachedModels,
  parseModels,
  supportsChatCompletions,
  toOpencodeModels,
  type FetchLike,
} from "../src/catalog.ts";

describe("parseModels", () => {
  test("keeps usable entries and drops malformed ones", () => {
    const models = parseModels({
      data: [
        {
          context_length: 1000,
          id: "a",
          name: "A",
          supported_endpoints: ["/chat/completions"],
        },
        { id: "" },
        { name: "no id" },
        "nope",
      ],
    });

    expect(models).toEqual([
      {
        contextLength: 1000,
        id: "a",
        name: "A",
        supportedEndpoints: ["/chat/completions"],
      },
    ]);
  });

  test("returns an empty list for a bad payload", () => {
    expect(parseModels(null)).toEqual([]);
    expect(parseModels({ data: "nope" })).toEqual([]);
  });
});

describe("toOpencodeModels", () => {
  test("keeps only chat-completions models and applies defaults", () => {
    const models = parseModels({
      data: [
        {
          context_length: 1_000_000,
          id: "deepseek/x",
          name: "DeepSeek",
          supported_endpoints: ["/chat/completions", "/responses"],
        },
        {
          id: "claude/y",
          name: "Claude",
          supported_endpoints: ["/messages"],
        },
        { id: "plain", supported_endpoints: ["/chat/completions"] },
      ],
    });

    const result = toOpencodeModels(models);

    expect(Object.keys(result)).toEqual(["deepseek/x", "plain"]);
    expect(result["deepseek/x"]).toMatchObject({
      id: "deepseek/x",
      name: "DeepSeek",
      tool_call: true,
      limit: { context: 1_000_000 },
    });
    expect(result.plain?.name).toBe("plain");
    expect(result.plain?.limit.context).toBe(128_000);
  });

  test("reports endpoint support", () => {
    const models = parseModels({
      data: [
        { id: "a", supported_endpoints: ["/chat/completions"] },
        { id: "b", supported_endpoints: ["/messages"] },
      ],
    });

    expect(supportsChatCompletions(models[0]!)).toBe(true);
    expect(supportsChatCompletions(models[1]!)).toBe(false);
  });
});

describe("parseCachedModels", () => {
  test("round-trips a normalized array", () => {
    const models = [
      {
        contextLength: 5,
        id: "a",
        name: "A",
        supportedEndpoints: ["/chat/completions"],
      },
    ];

    expect(parseCachedModels(models)).toEqual(models);
    expect(parseCachedModels("nope")).toEqual([]);
  });
});

describe("fetchCatalog", () => {
  test("sends auth and parses the payload", async () => {
    let seenUrl = "";
    let seenAuth = "";
    const fetchImpl: FetchLike = async (input, init) => {
      seenUrl = String(input);
      seenAuth =
        (init?.headers as Record<string, string> | undefined)?.Authorization ??
        "";
      return Response.json({
        data: [{ id: "a", supported_endpoints: ["/chat/completions"] }],
      });
    };

    const models = await fetchCatalog({ apiKey: "key", fetchImpl });

    expect(seenUrl).toBe("https://api.commandcode.ai/provider/v1/models");
    expect(seenAuth).toBe("Bearer key");
    expect(models?.[0]?.id).toBe("a");
  });

  test("returns null on transport and HTTP failures", async () => {
    const thrown = await fetchCatalog({
      apiKey: "key",
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    expect(thrown).toBeNull();

    const unauthorized = await fetchCatalog({
      apiKey: "key",
      fetchImpl: async () => new Response("", { status: 401 }),
    });
    expect(unauthorized).toBeNull();
  });
});

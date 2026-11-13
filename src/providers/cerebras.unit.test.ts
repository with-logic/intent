import { describe, expect, test, vi } from "vitest";

import { CONFIG } from "../config";

import { createCerebrasSdk, createDefaultCerebrasClient } from "./cerebras";

import type { CerebrasSdkLike } from "./cerebras";

const SCHEMA = { type: "object", properties: {}, additionalProperties: false } as const;
const MESSAGES = [
  { role: "system", content: "sys" },
  { role: "user", content: "hi" },
] as const;

/**
 * Build a fake SDK whose `create` returns the given contents in order.
 *
 * @param contents - Message contents to return, one per call
 * @returns Fake SDK and its `create` mock
 */
function makeSdk(...contents: Array<string | null>) {
  const create = vi.fn();
  for (const content of contents) {
    create.mockResolvedValueOnce({
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content } }],
    });
  }
  return { create, sdk: { chat: { completions: { create } } } as unknown as CerebrasSdkLike };
}

describe("cerebras provider", () => {
  test("sends a strict json_schema request with config defaults and temperature 0", async () => {
    const { create, sdk } = makeSdk('{"A":1}');
    const client = createDefaultCerebrasClient("key", { sdk });

    const result = await client.call<{ A: number }>([...MESSAGES], SCHEMA as any);

    expect(result).toEqual({ data: { A: 1 } });
    expect(create).toHaveBeenCalledTimes(1);
    const [request, options] = create.mock.calls[0]!;
    expect(request).toEqual({
      model: "qwen-3.8-27b",
      reasoning_effort: "none",
      temperature: 0,
      messages: [...MESSAGES],
      response_format: {
        type: "json_schema",
        json_schema: { name: "intent_relevancy", schema: SCHEMA, strict: true },
      },
    });
    expect(options).toBeUndefined();
    expect(CONFIG.CEREBRAS.DEFAULT_MODEL).toBe("qwen-3.8-27b");
  });

  test("per-call config, client defaults, user id and timeout are applied", async () => {
    const { create, sdk } = makeSdk("{}", "{}");
    const client = createDefaultCerebrasClient("key", {
      sdk,
      defaults: { model: "default-model", reasoningEffort: "low" },
    });

    await client.call([...MESSAGES], SCHEMA as any, undefined, "user-1");
    await client.call([...MESSAGES], SCHEMA as any, {
      model: "gpt-oss-120b",
      reasoningEffort: "high",
      timeoutMs: 1234,
    });

    const [first, firstOptions] = create.mock.calls[0]!;
    expect(first.model).toBe("default-model");
    expect(first.reasoning_effort).toBe("low");
    expect(first.user).toBe("user-1");
    expect(firstOptions).toBeUndefined();
    const [second, secondOptions] = create.mock.calls[1]!;
    expect(second.model).toBe("gpt-oss-120b");
    expect(second.reasoning_effort).toBe("high");
    expect(second).not.toHaveProperty("user");
    expect(secondOptions).toEqual({ timeout: 1234 });
  });

  test("rejects tool role messages before calling the SDK", async () => {
    const { create, sdk } = makeSdk();
    const client = createDefaultCerebrasClient("key", { sdk });

    await expect(client.call([{ role: "tool", content: "x" }], SCHEMA as any)).rejects.toThrow(
      /'tool' role messages are not supported/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  test("repairs invalid JSON by appending the bad output and the parse error", async () => {
    const { create, sdk } = makeSdk('{"A":', '{"A":2}');
    const client = createDefaultCerebrasClient("key", { sdk });

    const result = await client.call<{ A: number }>([...MESSAGES], SCHEMA as any);

    expect(result.data).toEqual({ A: 2 });
    expect(create).toHaveBeenCalledTimes(2);
    const repaired = create.mock.calls[1]![0].messages;
    expect(repaired).toHaveLength(MESSAGES.length + 2);
    expect(repaired[MESSAGES.length]).toEqual({ role: "assistant", content: '{"A":' });
    expect(repaired[MESSAGES.length + 1].role).toBe("user");
    expect(repaired[MESSAGES.length + 1].content).toMatch(/not valid JSON[\s\S]*Error: /);
    expect(create.mock.calls[0]![0].messages).toHaveLength(MESSAGES.length);
  });

  test("throws after the last repair attempt still returns invalid JSON", async () => {
    const { create, sdk } = makeSdk("nope", "still nope");
    const client = createDefaultCerebrasClient("key", { sdk, jsonRepairAttempts: 2 });

    await expect(client.call([...MESSAGES], SCHEMA as any)).rejects.toThrow(
      /Cerebras returned invalid JSON/,
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  test("makes one call when jsonRepairAttempts is 0", async () => {
    const { create, sdk } = makeSdk("nope");
    const client = createDefaultCerebrasClient("key", { sdk, jsonRepairAttempts: 0 });

    await expect(client.call([...MESSAGES], SCHEMA as any)).rejects.toThrow(/invalid JSON/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("does not retry SDK errors", async () => {
    const create = vi.fn().mockRejectedValue(new Error("429 rate limited"));
    const sdk = { chat: { completions: { create } } } as unknown as CerebrasSdkLike;
    const client = createDefaultCerebrasClient("key", { sdk });

    await expect(client.call([...MESSAGES], SCHEMA as any)).rejects.toThrow("429 rate limited");
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("throws when the response has no text content", async () => {
    const { sdk } = makeSdk(null);
    const client = createDefaultCerebrasClient("key", { sdk });

    await expect(client.call([...MESSAGES], SCHEMA as any)).rejects.toThrow(
      "Cerebras did not return content",
    );
  });

  test("throws when the response is not a chat completion", async () => {
    const create = vi.fn().mockResolvedValue({ error: { message: "boom" } });
    const sdk = { chat: { completions: { create } } } as unknown as CerebrasSdkLike;
    const client = createDefaultCerebrasClient("key", { sdk });

    await expect(client.call([...MESSAGES], SCHEMA as any)).rejects.toThrow(
      "Cerebras did not return content",
    );
  });

  test("builds the real SDK client without network traffic", () => {
    const sdk = createCerebrasSdk("test-key");
    expect(typeof sdk.chat.completions.create).toBe("function");
  });

  test("creates the real SDK client when no sdk is injected", () => {
    const client = createDefaultCerebrasClient("test-key");
    expect(typeof client.call).toBe("function");
  });
});

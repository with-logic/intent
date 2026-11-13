import Cerebras from "@cerebras/cerebras_cloud_sdk";
import { describe, expect, test, vi } from "vitest";

import { CONFIG } from "../config";

import { createDefaultCerebrasClient } from "./cerebras";

import type { JSONObject } from "../types";
import type { CerebrasSdkLike } from "./cerebras";
import type { ChatCompletion } from "@cerebras/cerebras_cloud_sdk/resources/chat/completions";

vi.mock("@cerebras/cerebras_cloud_sdk", () => ({ default: vi.fn() }));

type CreateFn = CerebrasSdkLike["chat"]["completions"]["create"];

const SCHEMA: JSONObject = { type: "object", properties: {}, additionalProperties: false };
const MESSAGES = [
  { role: "system", content: "sys" },
  { role: "user", content: "hi" },
] as const;

/**
 * Build a completion fixture.
 *
 * @param content - Message content
 * @param finishReason - Optional finish reason
 * @returns A completion with the fields the provider reads
 */
function makeCompletion(content: string | null, finishReason?: string): ChatCompletion {
  // Partial fixture: the provider reads only `object` and `choices`.
  return {
    object: "chat.completion",
    choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content } }],
  } as ChatCompletion;
}

/**
 * Wrap a `create` mock in the SDK shape.
 *
 * @param create - Mock for `chat.completions.create`
 * @returns Fake SDK
 */
function sdkOf(create: CreateFn): CerebrasSdkLike {
  return { chat: { completions: { create } } };
}

/**
 * Build a fake SDK whose `create` returns the given contents in order.
 *
 * @param contents - Message contents to return, one per call
 * @returns Fake SDK and its `create` mock
 */
function makeSdk(...contents: Array<string | null>) {
  const create = vi.fn<CreateFn>();
  for (const content of contents) {
    create.mockResolvedValueOnce(makeCompletion(content));
  }
  return { create, sdk: sdkOf(create) };
}

describe("cerebras provider", () => {
  test("sends a strict json_schema request with config defaults and temperature 0", async () => {
    const { create, sdk } = makeSdk('{"A":1}');
    const client = createDefaultCerebrasClient("key", { sdk });

    const result = await client.call<{ A: number }>([...MESSAGES], SCHEMA);

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

    await client.call([...MESSAGES], SCHEMA, undefined, "user-1");
    await client.call([...MESSAGES], SCHEMA, {
      model: "gpt-oss-120b",
      reasoningEffort: "high",
      timeoutMs: 1234,
    });

    const [first, firstOptions] = create.mock.calls[0]!;
    expect(first).toMatchObject({
      model: "default-model",
      reasoning_effort: "low",
      user: "user-1",
    });
    expect(firstOptions).toBeUndefined();
    const [second, secondOptions] = create.mock.calls[1]!;
    expect(second).toMatchObject({ model: "gpt-oss-120b", reasoning_effort: "high" });
    expect(second).not.toHaveProperty("user");
    expect(secondOptions).toEqual({ timeout: 1234 });
  });

  test("rejects tool role messages before calling the SDK", async () => {
    const { create, sdk } = makeSdk();
    const client = createDefaultCerebrasClient("key", { sdk });

    await expect(client.call([{ role: "tool", content: "x" }], SCHEMA)).rejects.toThrow(
      /'tool' role messages are not supported/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  test("repairs invalid JSON by appending the bad output and the parse error", async () => {
    const { create, sdk } = makeSdk('{"A":', '{"A":2}');
    const client = createDefaultCerebrasClient("key", { sdk });

    const result = await client.call<{ A: number }>([...MESSAGES], SCHEMA);

    expect(result.data).toEqual({ A: 2 });
    expect(create).toHaveBeenCalledTimes(2);
    const repaired = create.mock.calls[1]![0].messages;
    expect(repaired).toHaveLength(MESSAGES.length + 2);
    expect(repaired[MESSAGES.length]).toEqual({ role: "assistant", content: '{"A":' });
    expect(repaired[MESSAGES.length + 1]).toMatchObject({
      role: "user",
      content: expect.stringMatching(/not valid JSON[\s\S]*Error: /),
    });
    expect(create.mock.calls[0]![0].messages).toHaveLength(MESSAGES.length);
  });

  test("throws after the last repair attempt still returns invalid JSON", async () => {
    const { create, sdk } = makeSdk("nope", "still nope");
    const client = createDefaultCerebrasClient("key", { sdk, jsonRepairAttempts: 2 });

    const error = await client.call([...MESSAGES], SCHEMA).catch((e: unknown) => e);

    expect(error).toMatchObject({
      message: expect.stringMatching(/Cerebras returned invalid JSON/),
    });
    expect((error as Error & { cause?: unknown }).cause).toBeInstanceOf(SyntaxError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  test("makes one call when jsonRepairAttempts is 0", async () => {
    const { create, sdk } = makeSdk("nope");
    const client = createDefaultCerebrasClient("key", { sdk, jsonRepairAttempts: 0 });

    await expect(client.call([...MESSAGES], SCHEMA)).rejects.toThrow(/invalid JSON/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("does not retry SDK errors", async () => {
    const create = vi.fn<CreateFn>().mockRejectedValue(new Error("429 rate limited"));
    const client = createDefaultCerebrasClient("key", { sdk: sdkOf(create) });

    await expect(client.call([...MESSAGES], SCHEMA)).rejects.toThrow("429 rate limited");
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("throws when the response has no text content", async () => {
    const { sdk } = makeSdk(null);
    const client = createDefaultCerebrasClient("key", { sdk });

    await expect(client.call([...MESSAGES], SCHEMA)).rejects.toThrow(
      "Cerebras did not return content",
    );
  });

  test("names the finish reason when the content is missing", async () => {
    const create = vi.fn<CreateFn>().mockResolvedValue(makeCompletion(null, "length"));
    const client = createDefaultCerebrasClient("key", { sdk: sdkOf(create) });

    await expect(client.call([...MESSAGES], SCHEMA)).rejects.toThrow(
      "Cerebras did not return content (object=chat.completion, finish_reason=length)",
    );
  });

  test("throws when the response is not a chat completion", async () => {
    // Error-shaped body: the SDK type union allows it, so the guard must handle it.
    const create = vi
      .fn<CreateFn>()
      .mockResolvedValue({ error: { message: "boom" } } as unknown as ChatCompletion);
    const client = createDefaultCerebrasClient("key", { sdk: sdkOf(create) });

    await expect(client.call([...MESSAGES], SCHEMA)).rejects.toThrow(
      "Cerebras did not return content (object=missing, finish_reason=n/a)",
    );
  });

  test("creates the SDK client with the TCP warm-up turned off", () => {
    createDefaultCerebrasClient("test-key");

    expect(Cerebras).toHaveBeenCalledWith({ apiKey: "test-key", warmTCPConnection: false });
  });
});

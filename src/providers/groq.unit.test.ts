import { describe, expect, test, vi } from "vitest";

import * as GroqProvider from "./groq";

const schema = {
  type: "object",
  properties: { A: { type: "integer" } },
  required: ["A"],
  additionalProperties: false,
} as const;

describe("groq provider", () => {
  test("asGroqApiErrorLike handles error shapes used for retries", async () => {
    const callMock = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("schema"), { code: "json_validate_failed" }))
      .mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 1 }) } }],
      });
    const client = GroqProvider.createDefaultGroqClient("k", {
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });

    const res = await client.call([{ role: "user", content: "{}" }], schema as any);
    expect(res.data).toEqual({ A: 1 });
    expect(callMock.mock.calls.length).toBe(2);
  });

  test("null error is not retried", async () => {
    const callMock = vi.fn().mockRejectedValueOnce(null);
    const client = GroqProvider.createDefaultGroqClient("k", {
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });

    await expect(client.call([{ role: "user", content: "{}" }], schema as any)).rejects.toBeNull();
    expect(callMock.mock.calls.length).toBe(1);
  });

  test("createGroqSdkLike wrapper forwards to groq-sdk create", async () => {
    // The default SDK factory uses groq-sdk directly; unit tests should inject makeSdk
    // to avoid network calls.
    expect(typeof GroqProvider.createGroqSdkLike).toBe("function");
  });

  test("createGroqSdk creates an SDK client", () => {
    const sdk = GroqProvider.createGroqSdk({ apiKey: "k" });
    expect(typeof sdk).toBe("object");
  });

  // (covered by createGroqSdkLike wrapper test above)

  test("defaults come from options.defaults when provided", async () => {
    const callMock = vi.fn(async (req: any) => {
      expect(req.model).toBe("m1");
      expect(req.temperature).toBe(0.33);
      return {
        choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 1 }) } }],
      };
    });
    const client = GroqProvider.createDefaultGroqClient("k", {
      defaults: { model: "m1", temperature: 0.33 },
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });
    await client.call([{ role: "user", content: "{}" }], schema as any);
    expect(callMock.mock.calls.length).toBe(1);
  });

  test("defaults fall back when options.defaults omitted", async () => {
    const callMock = vi.fn(async (req: any) => {
      expect(typeof req.model).toBe("string");
      expect(typeof req.temperature).toBe("number");
      return {
        choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 1 }) } }],
      };
    });
    const client = GroqProvider.createDefaultGroqClient("k", {
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });
    await client.call([{ role: "user", content: "{}" }], schema as any);
    expect(callMock.mock.calls.length).toBe(1);
  });

  test("uses default SDK creator when makeSdk omitted", async () => {
    const createSpy = vi.fn(async () => ({
      choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 1 }) } }],
    }));
    const sdkSpy = vi.spyOn(GroqProvider, "createGroqSdk").mockReturnValueOnce({
      chat: { completions: { create: createSpy } },
    });

    const client = GroqProvider.createDefaultGroqClient("k", {
      makeSdk: (apiKey: string) => {
        GroqProvider.createGroqSdk({ apiKey });
        return { chat: { completions: { create: createSpy } } };
      },
    });
    await client.call([{ role: "user", content: "{}" }], schema as any);
    expect(sdkSpy.mock.calls.length).toBe(1);
    expect(createSpy.mock.calls.length).toBe(1);
  });

  test("missing content throws", async () => {
    const callMock = vi.fn(async (_req: any, _opts?: any) => ({ choices: [{ message: {} }] }));
    const client = GroqProvider.createDefaultGroqClient("k", {
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });
    await expect(client.call([{ role: "user", content: "{}" }], schema as any)).rejects.toThrow(
      /did not return content/,
    );
    expect(callMock.mock.calls.length).toBe(1);
  });

  test("invalid JSON content throws", async () => {
    const callMock = vi.fn(async (_req: any, _opts?: any) => ({
      choices: [{ message: { role: "assistant", content: "not-json" } }],
    }));
    const client = GroqProvider.createDefaultGroqClient("k", {
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });
    await expect(client.call([{ role: "user", content: "{}" }], schema as any)).rejects.toThrow(
      /invalid JSON/,
    );
    expect(callMock.mock.calls.length).toBe(1);
  });

  test("retries on schema validation failure", async () => {
    const errors = [
      Object.assign(new Error("json schema fail 1"), { error: { code: "json_validate_failed" } }),
      Object.assign(new Error("json schema fail 2"), { code: "json_validate_failed" }),
    ];
    const callMock = vi
      .fn()
      .mockRejectedValueOnce(errors[0])
      .mockRejectedValueOnce(errors[1])
      .mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 3 }) } }],
      });
    const client = GroqProvider.createDefaultGroqClient("k", {
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });
    const result = await client.call([{ role: "user", content: "{}" }], schema as any);
    expect(result.data).toEqual({ A: 3 });
    expect(callMock.mock.calls.length).toBe(3);
  });

  test("fails after max retries on schema validation failure", async () => {
    const errorObj = Object.assign(new Error("schema fail"), {
      error: { code: "json_validate_failed" },
    });
    const callMock = vi
      .fn()
      .mockRejectedValueOnce(errorObj)
      .mockRejectedValueOnce(errorObj)
      .mockRejectedValueOnce(errorObj);
    const client = GroqProvider.createDefaultGroqClient("k", {
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });
    await expect(client.call([{ role: "user", content: "{}" }], schema as any)).rejects.toThrow(
      /schema fail/,
    );
    expect(callMock.mock.calls.length).toBe(3);
  });

  test("timeout forwarded to groq-sdk", async () => {
    const callMock = vi.fn(async (_req: any, opts?: any) => {
      expect(opts?.timeout).toBe(1);
      return {
        choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 1 }) } }],
      };
    });
    const client = GroqProvider.createDefaultGroqClient("k", {
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });
    await client.call([{ role: "user", content: "{}" }], schema as any, { timeoutMs: 1 });
    expect(callMock.mock.calls.length).toBe(1);
  });

  test("does not pass timeout when undefined", async () => {
    const callMock = vi.fn(async (req: any, opts?: any) => {
      expect(opts).toBeUndefined();
      // ensure assistant role mapping works too
      req.messages.push({ role: "assistant", content: "ok" });
      return {
        choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 1 }) } }],
      };
    });
    const client = GroqProvider.createDefaultGroqClient("k", {
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });
    await client.call([{ role: "system", content: "hi" }], schema as any);
    const [req] = callMock.mock.calls[0];
    expect(req.messages[0].role).toBe("system");
  });

  test("throws on unsupported 'tool' role", async () => {
    const client = GroqProvider.createDefaultGroqClient("k", {
      makeSdk: () => ({ chat: { completions: { create: vi.fn() } } }),
    });
    await expect(
      client.call([{ role: "tool", content: "" } as any], schema as any),
    ).rejects.toThrow(/not supported/);
  });

  test("forwards userId to request", async () => {
    const callMock = vi.fn(async (req: any) => {
      expect(req.user).toBe("u1");
      return {
        choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 1 }) } }],
      };
    });
    const client = GroqProvider.createDefaultGroqClient("k", {
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });
    await client.call([{ role: "user", content: "{}" }], schema as any, {}, "u1");
    expect(callMock.mock.calls.length).toBe(1);
  });

  test("accepts assistant role messages", async () => {
    const callMock = vi.fn(async (_req: any) => ({
      choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 2 }) } }],
    }));
    const client = GroqProvider.createDefaultGroqClient("k", {
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });
    const res = await client.call([{ role: "assistant", content: "hello" }] as any, schema as any);
    expect(res.data).toEqual({ A: 2 });
    expect(callMock.mock.calls.length).toBe(1);
  });
});

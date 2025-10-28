import { describe, expect, test, vi } from "vitest";

const schema = {
  type: "object",
  properties: { A: { type: "integer" } },
  required: ["A"],
  additionalProperties: false,
} as const;

describe("groq provider", () => {
  test("missing content throws", async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const callMock = vi.fn(async (_req: any, _opts?: any) => ({ choices: [{ message: {} }] }));
    vi.doMock("groq-sdk", () => ({
      default: class Groq {
        chat = { completions: { create: callMock } };
        constructor(_cfg: any) {}
      },
    }));
    const { createDefaultGroqClient } = await import("./groq");
    const client = createDefaultGroqClient("k");
    await expect(client.call([{ role: "user", content: "{}" }], schema as any)).rejects.toThrow(
      /did not return content/,
    );
    expect(callMock.mock.calls.length).toBe(1);
  });

  test("invalid JSON content throws", async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const callMock = vi.fn(async (_req: any, _opts?: any) => ({
      choices: [{ message: { role: "assistant", content: "not-json" } }],
    }));
    vi.doMock("groq-sdk", () => ({
      default: class Groq {
        chat = { completions: { create: callMock } };
        constructor(_cfg: any) {}
      },
    }));
    const { createDefaultGroqClient } = await import("./groq");
    const client = createDefaultGroqClient("k");
    await expect(client.call([{ role: "user", content: "{}" }], schema as any)).rejects.toThrow(
      /invalid JSON/,
    );
    expect(callMock.mock.calls.length).toBe(1);
  });

  test("retries on schema validation failure", async () => {
    vi.resetModules();
    vi.clearAllMocks();
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
    vi.doMock("groq-sdk", () => ({
      default: class Groq {
        chat = { completions: { create: callMock } };
        constructor(_cfg: any) {}
      },
    }));
    const { createDefaultGroqClient } = await import("./groq");
    const client = createDefaultGroqClient("k");
    const result = await client.call([{ role: "user", content: "{}" }], schema as any);
    expect(result.data).toEqual({ A: 3 });
    expect(callMock.mock.calls.length).toBe(3);
  });

  test("fails after max retries on schema validation failure", async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const errorObj = Object.assign(new Error("schema fail"), {
      error: { code: "json_validate_failed" },
    });
    const callMock = vi
      .fn()
      .mockRejectedValueOnce(errorObj)
      .mockRejectedValueOnce(errorObj)
      .mockRejectedValueOnce(errorObj);
    vi.doMock("groq-sdk", () => ({
      default: class Groq {
        chat = { completions: { create: callMock } };
        constructor(_cfg: any) {}
      },
    }));
    const { createDefaultGroqClient } = await import("./groq");
    const client = createDefaultGroqClient("k");
    await expect(client.call([{ role: "user", content: "{}" }], schema as any)).rejects.toThrow(
      /schema fail/,
    );
    expect(callMock.mock.calls.length).toBe(3);
  });

  test("timeout forwarded to groq-sdk", async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const callMock = vi.fn(async (_req: any, opts?: any) => {
      expect(opts?.timeout).toBe(1);
      return {
        choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 1 }) } }],
      };
    });
    vi.doMock("groq-sdk", () => ({
      default: class Groq {
        chat = { completions: { create: callMock } };
        constructor(_cfg: any) {}
      },
    }));
    const { createDefaultGroqClient } = await import("./groq");
    const client = createDefaultGroqClient("k");
    await client.call([{ role: "user", content: "{}" }], schema as any, { timeoutMs: 1 });
    expect(callMock.mock.calls.length).toBe(1);
  });

  test("does not pass timeout when undefined", async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const callMock = vi.fn(async (req: any, opts?: any) => {
      expect(opts).toBeUndefined();
      // ensure assistant role mapping works too
      req.messages.push({ role: "assistant", content: "ok" });
      return {
        choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 1 }) } }],
      };
    });
    vi.doMock("groq-sdk", () => ({
      default: class Groq {
        chat = { completions: { create: callMock } };
        constructor(_cfg: any) {}
      },
    }));
    const { createDefaultGroqClient } = await import("./groq");
    const client = createDefaultGroqClient("k");
    await client.call([{ role: "system", content: "hi" }], schema as any);
    const [req] = callMock.mock.calls[0];
    expect(req.messages[0].role).toBe("system");
  });

  test("throws on unsupported 'tool' role", async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock("groq-sdk", () => ({
      default: class Groq {
        chat = { completions: { create: vi.fn() } };
        constructor(_cfg: any) {}
      },
    }));
    const { createDefaultGroqClient } = await import("./groq");
    const client = createDefaultGroqClient("k");
    await expect(
      client.call([{ role: "tool", content: "" } as any], schema as any),
    ).rejects.toThrow(/not supported/);
  });

  test("forwards userId to request", async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const callMock = vi.fn(async (req: any) => {
      expect(req.user).toBe("u1");
      return {
        choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 1 }) } }],
      };
    });
    vi.doMock("groq-sdk", () => ({
      default: class Groq {
        chat = { completions: { create: callMock } };
        constructor(_cfg: any) {}
      },
    }));
    const { createDefaultGroqClient } = await import("./groq");
    const client = createDefaultGroqClient("k");
    await client.call([{ role: "user", content: "{}" }], schema as any, {}, "u1");
    expect(callMock.mock.calls.length).toBe(1);
  });

  test("accepts assistant role messages", async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const callMock = vi.fn(async (_req: any) => ({
      choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 2 }) } }],
    }));
    vi.doMock("groq-sdk", () => ({
      default: class Groq {
        chat = { completions: { create: callMock } };
        constructor(_cfg: any) {}
      },
    }));
    const { createDefaultGroqClient } = await import("./groq");
    const client = createDefaultGroqClient("k");
    const res = await client.call([{ role: "assistant", content: "hello" }] as any, schema as any);
    expect(res.data).toEqual({ A: 2 });
    expect(callMock.mock.calls.length).toBe(1);
  });
});

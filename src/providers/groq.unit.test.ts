import { describe, expect, test, vi } from "vitest";

import * as GroqProvider from "./groq";

vi.mock("groq-sdk", () => {
  return {
    default: class GroqMock {
      chat = {
        completions: {
          create: vi.fn(async () => {
            return {
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: JSON.stringify({ A: 1 }),
                  },
                },
              ],
            };
          }),
        },
      };
    },
  };
});

const schema = {
  type: "object",
  properties: { A: { type: "integer" } },
  required: ["A"],
  additionalProperties: false,
} as const;

describe("groq provider", () => {
  test("createGroqSdkLike exists", () => {
    expect(typeof GroqProvider.createGroqSdkLike).toBe("function");
  });

  test("createGroqSdkLike wrapper forwards to groq-sdk create", async () => {
    const sdk = GroqProvider.createGroqSdkLike("k");
    const res = await sdk.chat.completions.create({} as any);
    expect(res.choices[0].message.content).toBe(JSON.stringify({ A: 1 }));
  });

  test("defaults makeSdk to createGroqSdkLike when omitted", async () => {
    const client = GroqProvider.createDefaultGroqClient("k", {
      jsonRepairAttempts: 1,
    });
    const res = await client.call([{ role: "user", content: "{}" }], schema as any);
    expect(res.data).toEqual({ A: 1 });
  });

  test("createGroqSdk creates an SDK client", () => {
    const sdk = GroqProvider.createGroqSdk({ apiKey: "k" });
    expect(typeof sdk).toBe("object");
  });

  test("defaults come from options.defaults when provided", async () => {
    const callMock = vi.fn(async (req: any) => {
      expect(req.model).toBe("m1");
      expect(req.reasoning_effort).toBe("high");
      return {
        choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 1 }) } }],
      };
    });
    const client = GroqProvider.createDefaultGroqClient("k", {
      defaults: { model: "m1", reasoningEffort: "high" },
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });
    await client.call([{ role: "user", content: "{}" }], schema as any);
    expect(callMock.mock.calls.length).toBe(1);
  });

  test("buildGroqRequest includes user when provided", async () => {
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

  test("defaults fall back when options.defaults omitted", async () => {
    const callMock = vi.fn(async (req: any) => {
      expect(typeof req.model).toBe("string");
      expect(["low", "medium", "high"].includes(req.reasoning_effort)).toBe(true);
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
    expect(callMock.mock.calls.length).toBe(3);
  });

  test("invalid JSON triggers repair messages with error details", async () => {
    const callMock = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", content: "not-json" } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 2 }) } }],
      });

    const client = GroqProvider.createDefaultGroqClient("k", {
      jsonRepairAttempts: 2,
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });

    const res = await client.call([{ role: "user", content: "{}" }], schema as any);
    expect(res.data).toEqual({ A: 2 });
    expect(callMock.mock.calls.length).toBe(2);

    const [firstReq] = callMock.mock.calls[0];
    const [secondReq] = callMock.mock.calls[1];
    expect(firstReq.messages.length).toBe(1);
    expect(secondReq.messages.length).toBe(3);
    expect(secondReq.messages[1].role).toBe("assistant");
    expect(secondReq.messages[1].content).toBe("not-json");
    expect(secondReq.messages[2].role).toBe("user");
    expect(String(secondReq.messages[2].content)).toMatch(/invalid JSON/);
  });

  test("parseJson includes non-Error JSON.parse details", async () => {
    const originalParse = JSON.parse;
    JSON.parse = (() => {
      throw "bad-json";
    }) as any;

    try {
      const callMock = vi.fn(async (_req: any) => ({
        choices: [{ message: { role: "assistant", content: "not-json" } }],
      }));
      const client = GroqProvider.createDefaultGroqClient("k", {
        jsonRepairAttempts: 0,
        makeSdk: () => ({ chat: { completions: { create: callMock } } }),
      });

      await expect(client.call([{ role: "user", content: "{}" }], schema as any)).rejects.toThrow(
        /bad-json/,
      );
    } finally {
      JSON.parse = originalParse;
    }
  });

  test("repair uses parseError message when parseError is an Error", async () => {
    const callMock = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", content: "not-json" } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 2 }) } }],
      });

    const originalParse = JSON.parse;
    JSON.parse = (() => {
      throw new Error("bad-json-error");
    }) as any;

    try {
      const client = GroqProvider.createDefaultGroqClient("k", {
        jsonRepairAttempts: 2,
        makeSdk: () => ({ chat: { completions: { create: callMock } } }),
      });

      await expect(client.call([{ role: "user", content: "{}" }], schema as any)).rejects.toThrow(
        /bad-json-error/,
      );
    } finally {
      JSON.parse = originalParse;
    }
  });

  test("repair appends parseError message when parseError is an Error", async () => {
    const callMock = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", content: "not-json" } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 2 }) } }],
      });

    const originalParse = JSON.parse;
    JSON.parse = (() => {
      throw new Error("bad-json-error");
    }) as any;

    try {
      const client = GroqProvider.createDefaultGroqClient("k", {
        jsonRepairAttempts: 2,
        makeSdk: () => ({ chat: { completions: { create: callMock } } }),
      });

      await expect(client.call([{ role: "user", content: "{}" }], schema as any)).rejects.toThrow(
        /bad-json-error/,
      );

      const [secondReq] = callMock.mock.calls[1];
      expect(String(secondReq.messages[2].content)).toMatch(/bad-json-error/);
    } finally {
      JSON.parse = originalParse;
    }
  });

  test("repair uses non-Error parseError stringification", async () => {
    const originalParse = JSON.parse;
    JSON.parse = (() => {
      throw "bad-json";
    }) as any;

    try {
      const callMock = vi
        .fn()
        .mockResolvedValueOnce({
          choices: [{ message: { role: "assistant", content: "not-json" } }],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 2 }) } }],
        });

      const client = GroqProvider.createDefaultGroqClient("k", {
        jsonRepairAttempts: 2,
        makeSdk: () => ({ chat: { completions: { create: callMock } } }),
      });

      await expect(client.call([{ role: "user", content: "{}" }], schema as any)).rejects.toThrow(
        /bad-json/,
      );
    } finally {
      JSON.parse = originalParse;
    }
  });

  test("repair is skipped when jsonRepairAttempts is 0", async () => {
    const callMock = vi.fn(async (_req: any) => ({
      choices: [{ message: { role: "assistant", content: "not-json" } }],
    }));
    const client = GroqProvider.createDefaultGroqClient("k", {
      jsonRepairAttempts: 0,
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });

    await expect(client.call([{ role: "user", content: "{}" }], schema as any)).rejects.toThrow(
      /invalid JSON/,
    );
    expect(callMock.mock.calls.length).toBe(1);
  });

  test("repair includes JSON.parse error details", async () => {
    const callMock = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", content: "not-json" } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 2 }) } }],
      });

    const client = GroqProvider.createDefaultGroqClient("k", {
      jsonRepairAttempts: 2,
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });

    const res = await client.call([{ role: "user", content: "{}" }], schema as any);
    expect(res.data).toEqual({ A: 2 });
    const [secondReq] = callMock.mock.calls[1];
    expect(String(secondReq.messages[2].content)).toMatch(/invalid JSON/);
  });

  test("retries on schema validation failure", async () => {
    const errors = [
      Object.assign(new Error("json schema fail 1"), {
        error: {
          error: {
            code: "json_validate_failed",
            generated_response: '{"A": "wrong"}',
            message: "details",
          },
        },
      }),
      Object.assign(new Error("json schema fail 2"), {
        error: {
          error: { code: "json_validate_failed", failed_generation: '{"A": "wrong2"}' },
        },
      }),
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

    const [secondReq] = callMock.mock.calls[1];
    expect(secondReq.messages[1].role).toBe("assistant");
    expect(secondReq.messages[1].content).toBe('{"A": "wrong"}');

    const [thirdReq] = callMock.mock.calls[2];
    expect(thirdReq.messages[1].role).toBe("assistant");
    expect(thirdReq.messages[1].content).toBe('{"A": "wrong"}');
  });

  test("fails after max retries on schema validation failure", async () => {
    const errorObj = Object.assign(new Error("schema fail"), {
      error: { error: { code: "json_validate_failed" } },
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

  test("retries on json_validate_failed when error payload exists only in Error.message", async () => {
    const callMock = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          '400 {"error":{"message":"Generated JSON does not match the expected schema. Please adjust your prompt. See \'failed_generation\' for more details. Error: jsonschema: \'/A\' does not validate with /properties/A/const: value must be \\"MUST_BE_THIS_EXACT_VALUE\\"","type":"invalid_request_error","code":"json_validate_failed","failed_generation":"{\\"A\\":\\"WRONG_VALUE\\"}"}}',
        ),
      )
      .mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 1 }) } }],
      });

    const client = GroqProvider.createDefaultGroqClient("k", {
      jsonRepairAttempts: 2,
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });

    const res = await client.call([{ role: "user", content: "{}" }], schema as any);
    expect(res.data).toEqual({ A: 1 });
    expect(callMock.mock.calls.length).toBe(2);

    const [secondReq] = callMock.mock.calls[1];
    expect(secondReq.messages.length).toBe(3);
    expect(secondReq.messages[1].role).toBe("assistant");
    expect(String(secondReq.messages[1].content)).toContain("WRONG_VALUE");
    expect(secondReq.messages[2].role).toBe("user");
    expect(String(secondReq.messages[2].content)).toMatch(/json_validate_failed/);
  });

  test("extractJsonValidateFailedRepairInput falls back to structured error when message is missing", async () => {
    const callMock = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("validation"), {
          message: "",
          error: {
            error: {
              code: "json_validate_failed",
              failed_generation: '{"A":"WRONG_VALUE"}',
              message: "details",
            },
          },
        }),
      )
      .mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 1 }) } }],
      });

    const client = GroqProvider.createDefaultGroqClient("k", {
      jsonRepairAttempts: 2,
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });

    const res = await client.call([{ role: "user", content: "{}" }], schema as any);
    expect(res.data).toEqual({ A: 1 });
    expect(callMock.mock.calls.length).toBe(2);
  });

  test("extractJsonValidateFailedRepairInput returns undefined for non-object error values", async () => {
    const callMock = vi
      .fn()
      .mockRejectedValueOnce("not-an-error")
      .mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 1 }) } }],
      });

    const client = GroqProvider.createDefaultGroqClient("k", {
      jsonRepairAttempts: 2,
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });

    await expect(client.call([{ role: "user", content: "{}" }], schema as any)).rejects.toBe(
      "not-an-error",
    );
    expect(callMock.mock.calls.length).toBe(1);
  });

  test("extractJsonValidateFailedRepairInput returns undefined when error.error is non-object", async () => {
    const callMock = vi.fn().mockRejectedValueOnce(
      Object.assign(new Error("validation"), {
        error: "not-an-object",
      }),
    );

    const client = GroqProvider.createDefaultGroqClient("k", {
      jsonRepairAttempts: 2,
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });

    await expect(client.call([{ role: "user", content: "{}" }], schema as any)).rejects.toThrow(
      /validation/,
    );
    expect(callMock.mock.calls.length).toBe(1);
  });

  test("extractJsonValidateFailedRepairInput can run with missing failed_generation in message", async () => {
    const callMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('400 {"error":{"code":"json_validate_failed"}}'))
      .mockResolvedValueOnce({
        choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 1 }) } }],
      });

    const client = GroqProvider.createDefaultGroqClient("k", {
      jsonRepairAttempts: 2,
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });

    await client.call([{ role: "user", content: "{}" }], schema as any);
    expect(callMock.mock.calls.length).toBe(2);
  });

  test("extractJsonValidateFailedRepairInput returns undefined when error is nested object but missing code", async () => {
    const callMock = vi.fn().mockRejectedValueOnce(
      Object.assign(new Error("no-code"), {
        error: { error: { message: "details" } },
      }),
    );

    const client = GroqProvider.createDefaultGroqClient("k", {
      jsonRepairAttempts: 2,
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
    });

    await expect(client.call([{ role: "user", content: "{}" }], schema as any)).rejects.toThrow(
      /no-code/,
    );
    expect(callMock.mock.calls.length).toBe(1);
  });

  test("getNestedErrorObject returns undefined for null", async () => {
    const callMock = vi.fn().mockRejectedValueOnce(null);
    const client = GroqProvider.createDefaultGroqClient("k", {
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
      jsonRepairAttempts: 2,
    });

    await expect(client.call([{ role: "user", content: "{}" }], schema as any)).rejects.toBeNull();
    expect(callMock.mock.calls.length).toBe(1);
  });

  test("getNestedErrorObject returns undefined for object with no error property", async () => {
    const callMock = vi.fn().mockRejectedValueOnce({ foo: "bar" });
    const client = GroqProvider.createDefaultGroqClient("k", {
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
      jsonRepairAttempts: 2,
    });

    await expect(client.call([{ role: "user", content: "{}" }], schema as any)).rejects.toEqual({
      foo: "bar",
    });
    expect(callMock.mock.calls.length).toBe(1);
  });

  test("getNestedErrorObject returns undefined for non-object error field", async () => {
    const callMock = vi.fn().mockRejectedValueOnce(
      Object.assign(new Error("boom"), {
        error: "nope",
      }),
    );
    const client = GroqProvider.createDefaultGroqClient("k", {
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
      jsonRepairAttempts: 2,
    });

    await expect(client.call([{ role: "user", content: "{}" }], schema as any)).rejects.toThrow(
      /boom/,
    );
    expect(callMock.mock.calls.length).toBe(1);
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

  // (userId forwarding covered above)

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

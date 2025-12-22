import { describe, expect, test, vi } from "vitest";

import { selectLlmClient } from "./llm_client";
import * as groqProvider from "./providers/groq";

describe("selectLlmClient", () => {
  test("returns ctx.llm when provided", () => {
    const llm = { call: vi.fn() };
    const selected = selectLlmClient(
      { llm } as any,
      {
        GROQ: { API_KEY: "k", DEFAULT_MODEL: "m", DEFAULT_REASONING_EFFORT: "medium" },
      } as any,
    );
    expect(selected).toBe(llm);
  });

  test("returns undefined when GROQ api key missing", () => {
    const selected = selectLlmClient({}, {
      GROQ: { API_KEY: "", DEFAULT_MODEL: "m", DEFAULT_REASONING_EFFORT: "medium" },
    } as any);
    expect(selected).toBeUndefined();
  });

  test("creates a default groq client using config defaults", async () => {
    const createSpy = vi
      .spyOn(groqProvider, "createDefaultGroqClient")
      .mockImplementation((apiKey, options) => {
        expect(apiKey).toBe("test-key");
        expect(options?.defaults?.model).toBe("test-model");
        expect(options?.defaults?.reasoningEffort).toBe("high");

        return {
          call: vi.fn(async (messages: any, schema: any) => ({ data: { A: 1 }, messages, schema })),
        } as any;
      });

    const config = {
      GROQ: {
        API_KEY: "test-key",
        DEFAULT_MODEL: "test-model",
        DEFAULT_REASONING_EFFORT: "high",
      },
    };

    const llm = selectLlmClient({}, config as any)!;
    const res = await llm.call([{ role: "user", content: "{}" }], {} as any);

    expect(res.data).toEqual({ A: 1 });
    expect(createSpy.mock.calls.length).toBe(1);
  });
});

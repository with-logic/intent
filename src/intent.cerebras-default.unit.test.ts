import { describe, expect, test, vi } from "vitest";

import { Intent } from "./intent";
import { createDefaultCerebrasClient } from "./providers/cerebras";

describe("Intent (default Cerebras)", () => {
  test("uses cerebras client (via DI)", async () => {
    const callMock = vi.fn(async (_req: any) => ({
      object: "chat.completion",
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({
              A: { explanation: "a", score: 10 },
              B: { explanation: "b", score: 0 },
            }),
          },
        },
      ],
    }));
    const llm = createDefaultCerebrasClient("test-key", {
      sdk: { chat: { completions: { create: callMock } } },
    });

    const intent = new Intent<{ key: string; summary: string }>({
      llm,
      key: (x) => x.key,
      summary: (x) => x.summary,
    });
    const out = await intent.rank("q", [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ]);
    expect(out.map((c) => c.key)).toEqual(["A"]);
    expect(callMock.mock.calls.length).toBe(1);
  });
});

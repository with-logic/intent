import { describe, expect, test, vi } from "vitest";

import { Intent } from "./intent";
import { createDefaultGroqClient } from "./providers/groq";

describe("Intent (default Groq) ", () => {
  test("uses groq client (via DI)", async () => {
    const callMock = vi.fn(async (_req: any) => ({
      choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 10, B: 0 }) } }],
    }));
    const llm = createDefaultGroqClient("test-key", {
      makeSdk: () => ({ chat: { completions: { create: callMock } } }),
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

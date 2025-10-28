import { describe, expect, test, vi } from "vitest";

// Mock groq-sdk before importing the reranker
const callMock = vi.fn(async (_req: any) => ({
  choices: [{ message: { role: "assistant", content: JSON.stringify({ A: 10, B: 0 }) } }],
}));
vi.mock("groq-sdk", () => ({
  default: class Groq {
    chat = { completions: { create: callMock } };
    constructor(_cfg: any) {}
  },
}));

const { Reranker } = await import("./reranker");

describe("Reranker (default Groq) ", () => {
  test("uses groq-sdk when GROQ_API_KEY is set", async () => {
    const oldKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "test-key";
    try {
      const reranker = new Reranker<{ key: string; summary: string }>(
        {
          /* no llm */
        },
        { key: (x) => x.key, summary: (x) => x.summary },
      );
      const out = await reranker.rerank("q", [
        { key: "A", summary: "" },
        { key: "B", summary: "" },
      ]);
      expect(out.map((c) => c.key)).toEqual(["A"]);
      expect(callMock.mock.calls.length).toBe(1);
    } finally {
      process.env.GROQ_API_KEY = oldKey;
    }
  });
});

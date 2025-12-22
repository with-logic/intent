import { describe, expect, test, vi } from "vitest";

import { CONFIG } from "./config";
import { Intent } from "./intent";
import { buildCandidateEvaluationSchema } from "./schema";

import type { LlmClient, LoggerLike, IntentCandidate, IntentContext } from "./types";

function makeCtx(overrides: Partial<IntentContext> = {}): IntentContext & {
  llm: LlmClient & { call: ReturnType<typeof vi.fn> };
  logger: Required<LoggerLike> & { warn: ReturnType<typeof vi.fn> };
} {
  const logger = {
    info: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    error: vi.fn(() => {}),
  } as any;
  const llm = {
    call: vi.fn(async () => ({ data: {} })),
  } as any;
  return {
    llm,
    logger,
    userId: undefined,
    ...overrides,
  } as any;
}

describe("Intent.rank", () => {
  test("uses GROQ default model when no model override is provided", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: {
        A: { explanation: "a", score: 10 },
        B: { explanation: "b", score: 0 },
      },
    });

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });

    await intent.rank("query", [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ]);

    const call = (ctx.llm.call as any).mock.calls[0];
    expect(call[2].model).toBe(CONFIG.GROQ.DEFAULT_MODEL);
  });

  test("candidate evaluation schema defines explanation before score", () => {
    const schema = buildCandidateEvaluationSchema();
    expect(Object.keys(schema.properties)).toEqual(["explanation", "score"]);
  });

  test("throws when no llm and no GROQ_API_KEY", async () => {
    const configOverride = {
      ...CONFIG,
      GROQ: { ...CONFIG.GROQ, API_KEY: "" },
    } as typeof CONFIG;
    expect(
      () => new Intent<IntentCandidate>({ key: (c) => c.key, config: configOverride }),
    ).toThrow(/No LLM client provided/);
  });

  test("throws when threshold is below 0", async () => {
    const ctx = makeCtx();
    expect(
      () => new Intent<IntentCandidate>({ ...ctx, key: (c) => c.key, relevancyThreshold: -1 }),
    ).toThrow(/relevancyThreshold must be between/);
  });

  test("throws when threshold is above 10", async () => {
    const ctx = makeCtx();
    expect(
      () => new Intent<IntentCandidate>({ ...ctx, key: (c) => c.key, relevancyThreshold: 11 }),
    ).toThrow(/relevancyThreshold must be between/);
  });

  test("throws when maxScore is below minScore", async () => {
    const ctx = makeCtx();
    expect(
      () =>
        new Intent<IntentCandidate>({
          ...ctx,
          key: (c) => c.key,
          minScore: 5,
          maxScore: 4,
        }),
    ).toThrow(/maxScore must be >= minScore/);
  });

  test("supports non-0..10 score ranges", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: {
        A: { explanation: "high", score: 5 },
        B: { explanation: "low", score: 3 },
      },
    });

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
      minScore: 2,
      maxScore: 5,
      relevancyThreshold: 3,
    });

    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];
    const res = await intent.rank("query", input);
    expect(res.map((c) => c.key)).toEqual(["A"]);
  });
  test("returns empty list for zero candidates", async () => {
    const ctx = makeCtx();
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const res = await intent.rank("query", []);
    expect(res).toEqual([]);
    expect(ctx.llm.call).not.toHaveBeenCalled();
  });

  test("returns input unchanged for single candidate (no LLM call)", async () => {
    const ctx = makeCtx();
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = [{ key: "Only", summary: "s" }];
    const res = await intent.rank("query", input);
    expect(res).toEqual(input);
    expect(ctx.llm.call).not.toHaveBeenCalled();
  });

  test("returns explanation wrapper for single candidate when explain is true (no LLM call)", async () => {
    const ctx = makeCtx();
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = [{ key: "Only", summary: "s" }];
    const res = await intent.rank("query", input, { explain: true });
    expect(res).toEqual([{ item: input[0], explanation: "" }]);
    expect(ctx.llm.call).not.toHaveBeenCalled();
  });

  test("returns explanations when explain option is true", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: {
        A: { explanation: "matches query", score: 10 },
        B: { explanation: "irrelevant", score: 0 },
      },
    });
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];
    const res = await intent.rank("query", input, { explain: true });
    expect(res).toEqual([{ item: input[0], explanation: "matches query" }]);
  });

  test("explain option is false by default (returns T[])", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: {
        A: { explanation: "matches query", score: 10 },
        B: { explanation: "irrelevant", score: 0 },
      },
    });
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];
    const res = await intent.rank("query", input);
    expect(res).toEqual([input[0]]);
  });

  test("rounds scores, filters zeros, orders by score", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: {
        A: { explanation: "a", score: 10 },
        B: { explanation: "b", score: 6.8 },
        C: { explanation: "c", score: 0 },
      },
    });
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = ["A", "B", "C"].map((k) => ({ key: k, summary: k }));
    const res = await intent.rank("query", input);
    expect(res.map((c) => c.key)).toEqual(["A", "B"]);
    const call = (ctx.llm.call as any).mock.calls[0];
    expect(call[2].timeoutMs).toBe(3000); // default
    expect(call[2].model).toBe("openai/gpt-oss-20b"); // GROQ default model
  });

  test("handles non-numeric or missing scores by clamping to 0", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: { X: { explanation: "x", score: "nope" as any } },
    });
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = ["X", "Y"].map((k) => ({ key: k, summary: k }));
    const res = await intent.rank("query", input);
    expect(res).toEqual([]);
  });

  test("normalizes out-of-range and infinite values", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: {
        A: { explanation: "a", score: -3 },
        B: { explanation: "b", score: 11 },
        C: { explanation: "c", score: 9.6 },
        D: { explanation: "d", score: Number.POSITIVE_INFINITY },
      },
    });
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = ["A", "B", "C", "D"].map((k) => ({ key: k, summary: k }));
    const res = await intent.rank("query", input);
    // B clamps to 10, D rounds to 10, keep input order for tie: B before D
    expect(res.map((c) => c.key)).toEqual(["B", "D", "C"]);
  });

  test("returns original list on error and logs warning", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockRejectedValueOnce(new Error("boom"));
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];
    const res = await intent.rank("query", input);
    expect(res).toEqual(input);
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  test("uses default extractors when both are missing", async () => {
    const ctx = makeCtx();
    // Return some scores so rank proceeds
    (ctx.llm.call as any).mockResolvedValueOnce({ data: {} });
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      // no key or summary extractors - will use defaults
      batchSize: 10,
    });
    const input: IntentCandidate[] = [
      { key: "A", summary: "original" },
      { key: "B", summary: "ignored" },
    ];
    await intent.rank("query", input);
    const call = (ctx.llm.call as any).mock.calls[0];
    const messages = call[0];
    const userPayload = JSON.parse(messages[1].content);
    const summaries = userPayload.candidate_search_results.map((c: any) => c.summary);
    // With default extractors, both key and summary will use JSON.stringify
    expect(summaries.every((s: string) => s.includes("original") || s.includes("ignored"))).toBe(
      true,
    );
  });

  test("uses empty summary when extractor is missing", async () => {
    const ctx = makeCtx();
    // Return some scores so rank proceeds
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: {
        A: { explanation: "a", score: 1 },
        B: { explanation: "b", score: 0 },
      },
    });
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      // no summary extractor - will use default
      batchSize: 10,
    });
    const input: IntentCandidate[] = [
      { key: "A", summary: "original" },
      { key: "B", summary: "ignored" },
    ];
    await intent.rank("query", input);
    const call = (ctx.llm.call as any).mock.calls[0];
    const messages = call[0];
    const userPayload = JSON.parse(messages[1].content);
    const summaries = userPayload.candidate_search_results.map((c: any) => c.summary);
    // With default summary extractor, will use JSON.stringify
    expect(summaries.every((s: string) => s.includes("original") || s.includes("ignored"))).toBe(
      true,
    );
  });

  test("top-level rank catch: logs and returns input on unexpected error", async () => {
    const ctx = makeCtx();
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    // @ts-ignore override private method to throw to trigger top-level catch
    intent.prepareCandidates = () => {
      throw new Error("oops");
    };
    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
      { key: "C", summary: "" },
    ];
    const res = await intent.rank("query", input);
    expect(res).toEqual(input);
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  test("top-level rank catch: logs and returns wrapped input when explain is true", async () => {
    const ctx = makeCtx();
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    // @ts-ignore override private method to throw to trigger top-level catch
    intent.prepareCandidates = () => {
      throw new Error("oops");
    };
    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
      { key: "C", summary: "" },
    ];

    const res = await intent.rank("query", input, { explain: true });
    expect(res).toEqual([
      { item: input[0], explanation: "" },
      { item: input[1], explanation: "" },
      { item: input[2], explanation: "" },
    ]);
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  test("passes userId from ctx and allows method override", async () => {
    const ctx = makeCtx({ userId: "ctx-user" });
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: {
        A: { explanation: "a", score: 5 },
        B: { explanation: "b", score: 5 },
      },
    });
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];
    await intent.rank("query", input, { userId: "call-user" });
    const calls = (ctx.llm.call as any).mock.calls;
    expect(calls[0][3]).toBe("call-user"); // override wins
  });

  test("timeout config is forwarded to client", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: {
        A: { explanation: "a", score: 5 },
        B: { explanation: "b", score: 5 },
      },
    });
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
      timeoutMs: 5,
    });
    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];
    await intent.rank("query", input);
    const calls = (ctx.llm.call as any).mock.calls;
    expect(calls[0][2].timeoutMs).toBe(5);
  });

  test("splits long lists into batches and combines results", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any)
      .mockResolvedValueOnce({
        data: {
          K2: { explanation: "k2", score: 10 },
          K0: { explanation: "k0", score: 7 },
        },
      })
      .mockResolvedValueOnce({
        data: {
          K7: { explanation: "k7", score: 10 },
          K6: { explanation: "k6", score: 9 },
        },
      });

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
      batchSize: 5,
    });

    const input: IntentCandidate[] = Array.from({ length: 10 }).map((_, i) => ({
      key: `K${i}`,
      summary: `S${i}`,
    }));

    const out = await intent.rank("query", input);
    expect(out.map((c) => c.key)).toEqual(["K2", "K0", "K7", "K6"]);
  });

  test("merges tiny final batch", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({ data: {} });

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
      batchSize: 5,
      tinyBatchFraction: 0.2,
    });

    const input: IntentCandidate[] = Array.from({ length: 7 }).map((_, i) => ({
      key: `K${i}`,
      summary: `S${i}`,
    }));

    await intent.rank("query", input);
    expect((ctx.llm.call as any).mock.calls.length).toBe(2);
  });

  test("merges really tiny final batch (<= threshold)", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({ data: {} });

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
      batchSize: 5,
      tinyBatchFraction: 0.2,
    });

    const input: IntentCandidate[] = Array.from({ length: 6 }).map((_, i) => ({
      key: `K${i}`,
      summary: `S${i}`,
    }));

    await intent.rank("query", input);
    expect((ctx.llm.call as any).mock.calls.length).toBe(1);
  });

  test("one batch fails while others succeed (partial fallback)", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any)
      .mockResolvedValueOnce({
        data: {
          K1: { explanation: "k1", score: 10 },
          K0: { explanation: "k0", score: 9 },
        },
      })
      .mockRejectedValueOnce(new Error("boom"));

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
      batchSize: 3,
    });

    const input: IntentCandidate[] = Array.from({ length: 6 }).map((_, i) => ({
      key: `K${i}`,
      summary: `S${i}`,
    }));

    const out = await intent.rank("query", input);
    expect(out.map((c) => c.key)).toEqual(["K1", "K0", "K3", "K4", "K5"]);
    expect((ctx.llm.call as any).mock.calls.length).toBe(2);
  });

  test("one batch fails while others succeed when explain is true (partial fallback)", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any)
      .mockResolvedValueOnce({
        data: {
          K1: { explanation: "k1", score: 10 },
          K0: { explanation: "k0", score: 9 },
        },
      })
      .mockRejectedValueOnce(new Error("boom"));

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
      batchSize: 3,
    });

    const input: IntentCandidate[] = Array.from({ length: 6 }).map((_, i) => ({
      key: `K${i}`,
      summary: `S${i}`,
    }));

    const out = await intent.rank("query", input, { explain: true });
    expect(out).toEqual([
      { item: input[1], explanation: "k1" },
      { item: input[0], explanation: "k0" },
      { item: input[3], explanation: "" },
      { item: input[4], explanation: "" },
      { item: input[5], explanation: "" },
    ]);
    expect((ctx.llm.call as any).mock.calls.length).toBe(2);
  });

  test("returns original list when scores payload is null", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({ data: null });
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input: IntentCandidate[] = [
      { key: "A", summary: "S" },
      { key: "B", summary: "S" },
    ];

    const out = await intent.rank("query", input);
    expect(out).toEqual(input);
  });

  test("returns blank explanations on null LLM payload when explain is true", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({ data: null });
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input: IntentCandidate[] = [
      { key: "A", summary: "S" },
      { key: "B", summary: "S" },
    ];

    const out = await intent.rank("query", input, { explain: true });
    expect(out).toEqual([
      { item: input[0], explanation: "" },
      { item: input[1], explanation: "" },
    ]);
  });

  test("stable order for ties within a batch (duplicate keys)", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: {
        Same: { explanation: "s0", score: 5 },
        "Same (1)": { explanation: "s1", score: 5 },
      },
    });

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });

    const input: IntentCandidate[] = [
      { key: "Same", summary: "S0" },
      { key: "Same", summary: "S1" },
    ];

    const out = await intent.rank("query", input);
    expect(out.map((c) => c.summary)).toEqual(["S0", "S1"]);
  });
});

describe("Intent.filter", () => {
  test("returns empty list for zero candidates", async () => {
    const ctx = makeCtx();
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const res = await intent.filter("query", []);
    expect(res).toEqual([]);
    expect(ctx.llm.call).not.toHaveBeenCalled();
  });

  test("returns input unchanged for single candidate (no LLM call)", async () => {
    const ctx = makeCtx();
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = [{ key: "Only", summary: "s" }];
    const res = await intent.filter("query", input);
    expect(res).toEqual(input);
    expect(ctx.llm.call).not.toHaveBeenCalled();
  });

  test("with explain=true returns explanation wrapper for single candidate (no LLM call)", async () => {
    const ctx = makeCtx();
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = [{ key: "Only", summary: "s" }];
    const res = await intent.filter("query", input, { explain: true });
    expect(res).toEqual([{ item: input[0], explanation: "" }]);
    expect(ctx.llm.call).not.toHaveBeenCalled();
  });

  test("filters by boolean decision and preserves input order", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: {
        A: { explanation: "yes", isRelevant: true },
        B: { explanation: "no", isRelevant: false },
        C: { explanation: "yes", isRelevant: true },
      },
    });

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });

    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
      { key: "C", summary: "" },
    ];

    const res = await intent.filter("query", input);
    expect(res.map((x) => x.key)).toEqual(["A", "C"]);
  });

  test("explain=true returns explanations for kept items", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: {
        A: { explanation: 123, isRelevant: true },
        B: { explanation: "no", isRelevant: false },
      },
    });

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });

    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];
    const res = await intent.filter("query", input, { explain: true });
    expect(res).toEqual([{ item: input[0], explanation: "" }]);
  });

  test("returns original list on error and logs warning", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockRejectedValueOnce(new Error("boom"));
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];
    const res = await intent.filter("query", input);
    expect(res).toEqual(input);
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  test("on error returns wrapped input when explain=true", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockImplementationOnce(() => Promise.reject(new Error("boom")));
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];

    const res = await intent.filter("query", input, { explain: true });
    expect(res).toEqual([
      { item: input[0], explanation: "" },
      { item: input[1], explanation: "" },
    ]);
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  test("returns original list when LLM response is null", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({ data: null });
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];
    const res = await intent.filter("query", input);
    expect(res).toEqual(input);
  });

  test("passes userId override through filter requests", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: {
        A: { explanation: "", isRelevant: true },
        B: { explanation: "", isRelevant: false },
      },
    });

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });

    await intent.filter(
      "query",
      [
        { key: "A", summary: "" },
        { key: "B", summary: "" },
      ],
      { userId: "call-user" },
    );

    const call = (ctx.llm.call as any).mock.calls[0];
    expect(call[3]).toBe("call-user");
  });

  test("with explain=true returns wrapped input on top-level error", async () => {
    const ctx = makeCtx({ llm: undefined });
    const configOverride = {
      ...CONFIG,
      GROQ: { ...CONFIG.GROQ, API_KEY: "fake" },
    } as typeof CONFIG;

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      config: configOverride,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });

    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];
    const res = await intent.filter("query", input, { explain: true });
    expect(res).toEqual([
      { item: input[0], explanation: "" },
      { item: input[1], explanation: "" },
    ]);
    expect(ctx.logger.warn).toHaveBeenCalled();
  });
});

describe("Intent.choice", () => {
  test("throws for zero candidates", async () => {
    const ctx = makeCtx();
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });

    await expect(intent.choice("query", [])).rejects.toThrow(/requires at least one candidate/);
  });

  test("returns single candidate unchanged (no LLM call)", async () => {
    const ctx = makeCtx();
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = [{ key: "Only", summary: "s" }];
    const res = await intent.choice("query", input);
    expect(res).toEqual(input[0]);
    expect(ctx.llm.call).not.toHaveBeenCalled();
  });

  test("explain=true returns explanation wrapper for single candidate (no LLM call)", async () => {
    const ctx = makeCtx();
    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
    });

    const input = [{ key: "Only", summary: "s" }];
    const res = await intent.choice("query", input, { explain: true });
    expect(res).toEqual({ item: input[0], explanation: "" });
    expect(ctx.llm.call).not.toHaveBeenCalled();
  });

  test("returns chosen item based on selectedKey", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({ data: { selectedKey: "B" } });

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
      batchSize: 10,
    });

    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
      { key: "C", summary: "" },
    ];
    const res = await intent.choice("query", input);
    expect(res.key).toBe("B");
  });

  test("falls back to first item when LLM returns invalid data", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({ data: null });

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
      batchSize: 10,
    });

    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];
    const res = await intent.choice("query", input);
    expect(res).toEqual(input[0]);
  });

  test("falls back to first item when selectedKey is not in the batch", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: { explanation: "x", selectedKey: "Z" },
    });

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
      batchSize: 10,
    });

    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];
    const res = await intent.choice("query", input);
    expect(res).toEqual(input[0]);
  });

  test("explain=true returns chosen item with explanation", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: { explanation: "best", selectedKey: "A" },
    });

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
      batchSize: 10,
    });

    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];
    const res = await intent.choice("query", input, { explain: true });
    expect(res).toEqual({ item: input[0], explanation: "best" });
  });

  test("uses a tournament strategy when candidates exceed batchSize", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any)
      .mockResolvedValueOnce({ data: { explanation: "b1", selectedKey: "K1" } })
      .mockResolvedValueOnce({ data: { explanation: "b2", selectedKey: "K3" } })
      .mockResolvedValueOnce({ data: { explanation: "final", selectedKey: "K3" } });

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
      batchSize: 2,
    });

    const input: IntentCandidate[] = [
      { key: "K0", summary: "" },
      { key: "K1", summary: "" },
      { key: "K2", summary: "" },
      { key: "K3", summary: "" },
    ];

    const res = await intent.choice("query", input);
    expect(res.key).toBe("K3");
    expect((ctx.llm.call as any).mock.calls.length).toBe(3);
  });

  test("does not run a final round when there is only one batch winner", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: { explanation: "b", selectedKey: "K1" },
    });

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
      batchSize: 10,
    });

    const input: IntentCandidate[] = [
      { key: "K0", summary: "" },
      { key: "K1", summary: "" },
      { key: "K2", summary: "" },
    ];

    const res = await intent.choice("query", input);
    expect(res.key).toBe("K1");
    expect((ctx.llm.call as any).mock.calls.length).toBe(1);
  });

  test("with explain=true returns the single batch winner without running a final round", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: { explanation: "b", selectedKey: "K1" },
    });

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
      batchSize: 10,
    });

    const input: IntentCandidate[] = [
      { key: "K0", summary: "" },
      { key: "K1", summary: "" },
      { key: "K2", summary: "" },
    ];

    const res = await intent.choice("query", input, { explain: true });
    expect(res).toEqual({ item: input[1], explanation: "b" });
    expect((ctx.llm.call as any).mock.calls.length).toBe(1);
  });

  test("with explain=true returns wrapped first item on error", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockImplementationOnce(() => Promise.reject(new Error("boom")));

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
      batchSize: 10,
    });

    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];

    const res = await intent.choice("query", input, { explain: true });
    expect(res).toEqual({ item: input[0], explanation: "" });
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  test("passes userId override through choice requests", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: { explanation: "x", selectedKey: "A" },
    });

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
      batchSize: 10,
    });

    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];

    await intent.choice("query", input, { userId: "call-user" });
    const call = (ctx.llm.call as any).mock.calls[0];
    expect(call[3]).toBe("call-user");
  });

  test("runs a final round when there are multiple batch winners", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any)
      .mockResolvedValueOnce({ data: { selectedKey: "K1" } })
      .mockResolvedValueOnce({ data: { selectedKey: "K2" } })
      .mockResolvedValueOnce({ data: { selectedKey: "K2" } });

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
      batchSize: 2,
      tinyBatchFraction: 0,
    });

    const input: IntentCandidate[] = [
      { key: "K0", summary: "" },
      { key: "K1", summary: "" },
      { key: "K2", summary: "" },
      { key: "K3", summary: "" },
    ];

    const res = await intent.choice("query", input, { explain: true });
    expect(res.item.key).toBe("K2");
    expect((ctx.llm.call as any).mock.calls.length).toBe(3);
  });

  test("returns the first item when there are no batch winners", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({ data: { selectedKey: 123 } });

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
      batchSize: 10,
    });

    const input: IntentCandidate[] = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];

    const res = await intent.choice("query", input);
    expect(res).toEqual(input[0]);
  });

  test("on error returns the first item and logs warning", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockImplementationOnce(() => Promise.reject(new Error("boom")));

    const intent = new Intent<IntentCandidate>({
      ...ctx,
      key: (c) => c.key,
      summary: (c) => c.summary,
      batchSize: 10,
    });

    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];
    const res = await intent.choice("query", input);
    expect(res).toEqual(input[0]);
    expect(ctx.logger.warn).toHaveBeenCalled();
  });
});

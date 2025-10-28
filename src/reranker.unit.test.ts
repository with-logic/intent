import { describe, expect, test, vi } from "vitest";

import { Reranker } from "./reranker";

import type { LlmClient, LoggerLike, RerankerCandidate, IntentContext } from "./types";

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

describe("Reranker.rerank", () => {
  test("throws when no llm and no GROQ_API_KEY", async () => {
    const oldKey = process.env.GROQ_API_KEY;
    delete (process.env as any).GROQ_API_KEY;
    try {
      expect(() => new Reranker<RerankerCandidate>({} as any, { key: (c) => c.key })).toThrow(
        /No LLM client provided/,
      );
    } finally {
      process.env.GROQ_API_KEY = oldKey;
    }
  });

  test("throws when threshold is below 0", async () => {
    const ctx = makeCtx();
    expect(
      () =>
        new Reranker<RerankerCandidate>(ctx, { key: (c) => c.key }, { RELEVANCY_THRESHOLD: -1 }),
    ).toThrow(/RELEVANCY_THRESHOLD must be between 0 and 10/);
  });

  test("throws when threshold is above 10", async () => {
    const ctx = makeCtx();
    expect(
      () =>
        new Reranker<RerankerCandidate>(ctx, { key: (c) => c.key }, { RELEVANCY_THRESHOLD: 11 }),
    ).toThrow(/RELEVANCY_THRESHOLD must be between 0 and 10/);
  });
  test("returns empty list for zero candidates", async () => {
    const ctx = makeCtx();
    const reranker = new Reranker<RerankerCandidate>(ctx, {
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const res = await reranker.rerank("query", []);
    expect(res).toEqual([]);
    expect(ctx.llm.call).not.toHaveBeenCalled();
  });

  test("returns input unchanged for single candidate (no LLM call)", async () => {
    const ctx = makeCtx();
    const reranker = new Reranker<RerankerCandidate>(ctx, {
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = [{ key: "Only", summary: "s" }];
    const res = await reranker.rerank("query", input);
    expect(res).toEqual(input);
    expect(ctx.llm.call).not.toHaveBeenCalled();
  });

  test("rounds scores, filters zeros, orders by score", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: { A: 10, B: 6.8, C: 0 },
    });
    const reranker = new Reranker<RerankerCandidate>(ctx, {
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = ["A", "B", "C"].map((k) => ({ key: k, summary: k }));
    const res = await reranker.rerank("query", input);
    expect(res.map((c) => c.key)).toEqual(["A", "B"]);
    const call = (ctx.llm.call as any).mock.calls[0];
    expect(call[2].timeoutMs).toBe(3000); // default
  });

  test("handles non-numeric or missing scores by clamping to 0", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({ data: { X: "nope" as any } });
    const reranker = new Reranker<RerankerCandidate>(ctx, {
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = ["X", "Y"].map((k) => ({ key: k, summary: k }));
    const res = await reranker.rerank("query", input);
    expect(res).toEqual([]);
  });

  test("normalizes out-of-range and infinite values", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: { A: -3, B: 11, C: 9.6, D: Number.POSITIVE_INFINITY },
    });
    const reranker = new Reranker<RerankerCandidate>(ctx, {
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = ["A", "B", "C", "D"].map((k) => ({ key: k, summary: k }));
    const res = await reranker.rerank("query", input);
    // B clamps to 10, D rounds to 10, keep input order for tie: B before D
    expect(res.map((c) => c.key)).toEqual(["B", "D", "C"]);
  });

  test("returns original list on error and logs warning", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockRejectedValueOnce(new Error("boom"));
    const reranker = new Reranker<RerankerCandidate>(ctx, {
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];
    const res = await reranker.rerank("query", input);
    expect(res).toEqual(input);
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  test("uses empty summary when extractor is missing", async () => {
    const ctx = makeCtx();
    // Return some scores so rerank proceeds
    (ctx.llm.call as any).mockResolvedValueOnce({ data: { A: 1, B: 0 } });
    const reranker = new Reranker<RerankerCandidate>(
      ctx,
      {
        key: (c) => c.key,
        // no summary extractor
      },
      { BATCH_SIZE: 10 },
    );
    const input: RerankerCandidate[] = [
      { key: "A", summary: "original" },
      { key: "B", summary: "ignored" },
    ];
    await reranker.rerank("query", input);
    const call = (ctx.llm.call as any).mock.calls[0];
    const messages = call[0];
    const userPayload = JSON.parse(messages[1].content);
    const summaries = userPayload.candidate_search_results.map((c: any) => c.summary);
    expect(summaries).toEqual(["", ""]);
  });

  test("top-level rerank catch: logs and returns input on unexpected error", async () => {
    const ctx = makeCtx();
    const reranker = new Reranker<RerankerCandidate>(ctx, {
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    // @ts-ignore override private method to throw to trigger top-level catch
    reranker.prepareCandidates = () => {
      throw new Error("oops");
    };
    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
      { key: "C", summary: "" },
    ];
    const res = await reranker.rerank("query", input);
    expect(res).toEqual(input);
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  test("passes userId from ctx and allows method override", async () => {
    const ctx = makeCtx({ userId: "ctx-user" });
    (ctx.llm.call as any).mockResolvedValueOnce({ data: { A: 5, B: 5 } });
    const reranker = new Reranker<RerankerCandidate>(ctx, {
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];
    await reranker.rerank("query", input, { userId: "call-user" });
    const calls = (ctx.llm.call as any).mock.calls;
    expect(calls[0][3]).toBe("call-user"); // override wins
  });

  test("timeout config is forwarded to client", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({ data: { A: 5, B: 5 } });
    const reranker = new Reranker<RerankerCandidate>(
      ctx,
      { key: (c) => c.key, summary: (c) => c.summary },
      { TIMEOUT_MS: 5 },
    );
    const input = [
      { key: "A", summary: "" },
      { key: "B", summary: "" },
    ];
    await reranker.rerank("query", input);
    const calls = (ctx.llm.call as any).mock.calls;
    expect(calls[0][2].timeoutMs).toBe(5);
  });

  test("splits long lists into batches and combines results", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any)
      .mockResolvedValueOnce({ data: { K2: 10, K0: 7 } })
      .mockResolvedValueOnce({ data: { K7: 10, K6: 9 } });

    const reranker = new Reranker<RerankerCandidate>(
      ctx,
      { key: (c) => c.key, summary: (c) => c.summary },
      { BATCH_SIZE: 5 },
    );

    const input: RerankerCandidate[] = Array.from({ length: 10 }).map((_, i) => ({
      key: `K${i}`,
      summary: `S${i}`,
    }));

    const out = await reranker.rerank("query", input);
    expect(out.map((c) => c.key)).toEqual(["K2", "K0", "K7", "K6"]);
  });

  test("merges tiny final batch", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({ data: {} });

    const reranker = new Reranker<RerankerCandidate>(
      ctx,
      { key: (c) => c.key, summary: (c) => c.summary },
      { BATCH_SIZE: 5, TINY_BATCH_FRACTION: 0.2 },
    );

    const input: RerankerCandidate[] = Array.from({ length: 7 }).map((_, i) => ({
      key: `K${i}`,
      summary: `S${i}`,
    }));

    await reranker.rerank("query", input);
    expect((ctx.llm.call as any).mock.calls.length).toBe(2);
  });

  test("merges really tiny final batch (<= threshold)", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({ data: {} });

    const reranker = new Reranker<RerankerCandidate>(
      ctx,
      { key: (c) => c.key, summary: (c) => c.summary },
      { BATCH_SIZE: 5, TINY_BATCH_FRACTION: 0.2 },
    );

    const input: RerankerCandidate[] = Array.from({ length: 6 }).map((_, i) => ({
      key: `K${i}`,
      summary: `S${i}`,
    }));

    await reranker.rerank("query", input);
    expect((ctx.llm.call as any).mock.calls.length).toBe(1);
  });

  test("one batch fails while others succeed (partial fallback)", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any)
      .mockResolvedValueOnce({ data: { K1: 10, K0: 9 } })
      .mockRejectedValueOnce(new Error("boom"));

    const reranker = new Reranker<RerankerCandidate>(
      ctx,
      { key: (c) => c.key, summary: (c) => c.summary },
      { BATCH_SIZE: 3 },
    );

    const input: RerankerCandidate[] = Array.from({ length: 6 }).map((_, i) => ({
      key: `K${i}`,
      summary: `S${i}`,
    }));

    const out = await reranker.rerank("query", input);
    expect(out.map((c) => c.key)).toEqual(["K1", "K0", "K3", "K4", "K5"]);
    expect((ctx.llm.call as any).mock.calls.length).toBe(2);
  });

  test("returns original list when scores payload is null", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({ data: null });
    const reranker = new Reranker<RerankerCandidate>(ctx, {
      key: (c) => c.key,
      summary: (c) => c.summary,
    });
    const input: RerankerCandidate[] = [
      { key: "A", summary: "S" },
      { key: "B", summary: "S" },
    ];

    const out = await reranker.rerank("query", input);
    expect(out).toEqual(input);
  });

  test("stable order for ties within a batch (duplicate keys)", async () => {
    const ctx = makeCtx();
    (ctx.llm.call as any).mockResolvedValueOnce({
      data: { Same: 5, "Same (1)": 5 },
    });

    const reranker = new Reranker<RerankerCandidate>(ctx, {
      key: (c) => c.key,
      summary: (c) => c.summary,
    });

    const input: RerankerCandidate[] = [
      { key: "Same", summary: "S0" },
      { key: "Same", summary: "S1" },
    ];

    const out = await reranker.rerank("query", input);
    expect(out.map((c) => c.summary)).toEqual(["S0", "S1"]);
  });
});

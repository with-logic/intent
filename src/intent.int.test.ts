import { describe, expect, test } from "vitest";

import { Intent } from "./intent";

describe("reranker integration", () => {
  const defaultTimeoutMs = 10000;
  const scoreRange = { minScore: 0, maxScore: 10 };

  test.concurrent(
    "ranks obvious match first",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
        relevancyThreshold: 0,
      });

      const out = await intent.rank("Help me sort a JavaScript array", [
        { key: "JS Arrays", summary: "Guide to sorting arrays in JavaScript" },
        { key: "Saturns Moons", summary: "The chemical composition of Saturn's moons" },
        { key: "Eiffel Tower", summary: "Directions to the tower" },
      ]);

      expect(out.length).toBeGreaterThanOrEqual(1);
      expect(out[0]?.key).toBe("JS Arrays");
    },
    30000,
  );

  test.concurrent(
    "returns empty list when everything is unrelated (threshold > minScore)",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
        relevancyThreshold: scoreRange.minScore + 1,
        ...scoreRange,
      });

      const out = await intent.rank("JavaScript array sorting", [
        { key: "Banana Bread", summary: "How to bake banana bread" },
        { key: "Eiffel Tower", summary: "Timeline of the Eiffel Tower construction" },
        { key: "Roman Emperors", summary: "A list of Roman emperors" },
      ]);

      expect(out).toEqual([]);
    },
    30000,
  );

  test.concurrent(
    "preserves input order on ties (or near-ties) between similar candidates",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
        relevancyThreshold: 0,
      });

      const input = [
        { key: "Guide A", summary: "How to sort JavaScript arrays with Array.prototype.sort" },
        { key: "Guide B", summary: "Sorting arrays in JavaScript using a comparator function" },
        { key: "Guide C", summary: "JavaScript array sorting examples and best practices" },
      ];

      const out = await intent.rank("JavaScript array sorting", input);
      expect(out.length).toBeGreaterThanOrEqual(1);

      const outputKeys = out.map((x) => x.key);
      for (const k of outputKeys) {
        expect(input.some((i) => i.key === k)).toBe(true);
      }

      if (out.length === input.length) {
        expect(outputKeys).toEqual(input.map((x) => x.key));
      }
    },
    30000,
  );

  test.concurrent(
    "explain=true returns item+explanation and filters by threshold",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
        relevancyThreshold: 1,
      });

      const out = await intent.rank(
        "Help me sort a JavaScript array",
        [
          { key: "JS Arrays", summary: "Guide to sorting arrays in JavaScript" },
          { key: "Banana Bread", summary: "How to bake banana bread" },
        ],
        { explain: true },
      );

      expect(out.length).toBeGreaterThanOrEqual(1);
      expect(out[0]?.item.key).toBe("JS Arrays");
      expect(typeof out[0]?.explanation).toBe("string");
      expect(out[0]?.explanation.length).toBeGreaterThan(0);
    },
    30000,
  );

  test.concurrent(
    "supports custom extractors over nested objects",
    async () => {
      type Doc = { id: string; meta: { title: string }; body: string };
      const intent = new Intent<Doc>({
        key: (d) => d.meta.title,
        summary: (d) => d.body,
        timeoutMs: defaultTimeoutMs,
        relevancyThreshold: 1,
      });

      const out = await intent.rank("find expense reports", [
        { id: "1", meta: { title: "Expense report Q3" }, body: "Travel and meals reimbursement" },
        { id: "2", meta: { title: "Vacation photos" }, body: "Beach, family, sunsets" },
      ]);

      expect(out.length).toBe(1);
      expect(out[0]?.meta.title).toBe("Expense report Q3");
    },
    30000,
  );

  test.concurrent(
    "supports unicode keys and summaries",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
        relevancyThreshold: 0,
      });

      const out = await intent.rank("JavaScript array sorting", [
        { key: "Café", summary: "Guía para ordenar arrays en JavaScript" },
        { key: "東京", summary: "JavaScriptで配列をソートする方法" },
        { key: "Banana Bread", summary: "How to bake banana bread" },
      ]);

      expect(out.length).toBeGreaterThanOrEqual(1);
      expect(["Café", "東京"].includes(out[0]?.key ?? "")).toBe(true);
    },
    30000,
  );

  test.concurrent(
    "supports keys with punctuation and whitespace",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
        relevancyThreshold: 0,
      });

      const out = await intent.rank("JavaScript array sorting", [
        {
          key: "Array.sort() / comparator",
          summary: "Using Array.prototype.sort with a compare function in JS",
        },
        {
          key: "Stable sort: ties, order",
          summary: "How stable sorting behaves; preserving order for equal elements",
        },
        {
          key: "Key with spaces\n(and newline)",
          summary: "Examples of sorting arrays in JavaScript",
        },
      ]);

      expect(out.length).toBeGreaterThanOrEqual(1);
    },
    30000,
  );

  test.concurrent(
    "disambiguates duplicate keys without failing",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
        relevancyThreshold: 0,
      });

      const out = await intent.rank("JavaScript array sorting", [
        { key: "Same", summary: "Sorting arrays in JavaScript" },
        { key: "Same", summary: "Another note about Array.prototype.sort" },
        { key: "Other", summary: "Banana bread recipe" },
      ]);

      expect(out.length).toBeGreaterThanOrEqual(1);
      expect(out.some((x) => x.key === "Same")).toBe(true);
    },
    30000,
  );

  test.concurrent(
    "supports non-0..10 score ranges",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
        minScore: 1,
        maxScore: 5,
        relevancyThreshold: 2,
      });

      const out = await intent.rank("JavaScript array sorting", [
        { key: "JS Arrays", summary: "Guide to sorting arrays in JavaScript" },
        { key: "Banana Bread", summary: "How to bake banana bread" },
      ]);

      expect(out.length).toBeGreaterThanOrEqual(1);
      expect(out[0]?.key).toBe("JS Arrays");
    },
    30000,
  );

  test.concurrent(
    "handles batching for larger candidate sets",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
        batchSize: 3,
        tinyBatchFraction: 0.2,
        relevancyThreshold: 0,
      });

      const candidates = [
        { key: "Array.sort", summary: "JavaScript Array.prototype.sort reference" },
        { key: "Comparator", summary: "How to write a comparator function in JS" },
        { key: "Stable sort", summary: "Discussion of stable sorting behavior" },
        { key: "Quickstart", summary: "Basic JS arrays tutorial" },
        { key: "Banana bread", summary: "Recipe for banana bread" },
        { key: "Eiffel Tower", summary: "History of the Eiffel Tower" },
        { key: "Node streams", summary: "Guide to Node.js streams" },
      ];

      const out = await intent.rank("JavaScript array sorting", candidates);
      expect(out.length).toBeGreaterThanOrEqual(1);
      expect(out.length).toBeLessThanOrEqual(candidates.length);
    },
    60000,
  );

  test.concurrent(
    "stress: ranks with many candidates across batches",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
        batchSize: 5,
        tinyBatchFraction: 0.2,
        relevancyThreshold: 0,
      });

      const candidates = Array.from({ length: 30 }).map((_, i) => ({
        key: `Doc ${i + 1}`,
        summary:
          i % 6 === 0
            ? "JavaScript array sorting with comparator and examples"
            : "Unrelated notes about cooking, travel, or history",
      }));

      const out = await intent.rank("JavaScript array sorting", candidates);
      expect(out.length).toBeGreaterThanOrEqual(1);
      expect(out.length).toBeLessThanOrEqual(candidates.length);
    },
    120000,
  );

  test.concurrent(
    "explain=true stays aligned with items across batching",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
        batchSize: 4,
        tinyBatchFraction: 0.2,
        relevancyThreshold: 0,
      });

      const input = Array.from({ length: 12 }).map((_, i) => ({
        key: `Item ${i + 1}`,
        summary: i % 3 === 0 ? "JavaScript array sorting examples" : "Completely unrelated topic",
      }));

      const out = await intent.rank("JavaScript array sorting", input, { explain: true });
      expect(out.length).toBeGreaterThanOrEqual(1);

      for (const r of out) {
        expect(input.some((x) => x.key === r.item.key)).toBe(true);
        expect(typeof r.explanation).toBe("string");
      }
    },
    120000,
  );

  test.concurrent(
    "accepts per-call userId override",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
        relevancyThreshold: 0,
      });

      const out = await intent.rank(
        "JavaScript array sorting",
        [
          { key: "JS Arrays", summary: "Guide to sorting arrays in JavaScript" },
          { key: "Banana Bread", summary: "How to bake banana bread" },
        ],
        { userId: "integration-test-user" },
      );

      expect(out.length).toBeGreaterThanOrEqual(1);
    },
    30000,
  );
});

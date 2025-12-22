import { describe, expect, test } from "vitest";

import { Intent } from "./intent";

describe("intent integration", () => {
  const defaultTimeoutMs = 10000;
  const scoreRange = { minScore: 0, maxScore: 10 };

  test.concurrent(
    "README quickstart: ranks simple strings and filters out unrelated items",
    async () => {
      const intent = new Intent({ relevancyThreshold: 1, timeoutMs: defaultTimeoutMs });

      const docs = [
        "Many network requests can fail intermittently due to transient issues.",
        "To reduce flaky tests, add exponential backoff with jitter to HTTP retries.",
        "Citrus fruits like oranges and lemons are high in vitamin C.",
      ];

      const ranked = await intent.rank("exponential backoff retries", docs);

      expect(ranked).toEqual([
        "To reduce flaky tests, add exponential backoff with jitter to HTTP retries.",
        "Many network requests can fail intermittently due to transient issues.",
      ]);
    },
    30000,
  );

  test.concurrent(
    "ranks the most relevant candidate first (simple object candidates)",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
        relevancyThreshold: 0,
      });

      const out = await intent.rank("Help me sort a JavaScript array", [
        { key: "Saturns Moons", summary: "The chemical composition of Saturn's moons" },
        { key: "JS Arrays", summary: "Guide to sorting arrays in JavaScript" },
        { key: "Eiffel Tower", summary: "Directions to the tower" },
      ]);

      expect(out.map((x) => x.key)).toEqual(["JS Arrays"]);
    },
    30000,
  );

  test.concurrent(
    "supports defaults: new Intent() ranks plain strings",
    async () => {
      const intent = new Intent();
      const items = ["apple", "banana", "orange", "grape"];

      const ranked = await intent.rank("citrus fruits", items);
      expect(ranked).toEqual(["orange"]);
    },
    30000,
  );

  test.concurrent(
    "supports candidates with summary only (no key extractor)",
    async () => {
      const intent = new Intent<{ summary: string }>({
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
        relevancyThreshold: 0,
      });

      const out = await intent.rank("Help me sort a JavaScript array", [
        { summary: "The chemical composition of Saturn's moons" },
        { summary: "Guide to sorting arrays in JavaScript" },
        { summary: "Directions to the tower" },
      ]);

      expect(out).toEqual([{ summary: "Guide to sorting arrays in JavaScript" }]);
    },
    30000,
  );

  test.concurrent(
    "supports candidates with key only (no summary extractor)",
    async () => {
      const intent = new Intent<{ key: string }>({
        key: (x) => x.key,
        timeoutMs: defaultTimeoutMs,
        relevancyThreshold: 0,
      });

      const out = await intent.rank("Help me sort a JavaScript array", [
        { key: "Saturns Moons" },
        { key: "JS Arrays" },
        { key: "Eiffel Tower" },
      ]);

      expect(out).toEqual([{ key: "JS Arrays" }]);
    },
    30000,
  );

  test.concurrent(
    "returns [] when all candidates are unrelated and threshold > minScore",
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
    "preserves input order when all candidates are returned",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
        // All of these candidates should be obviously relevant, so all should pass a 0 threshold.
        relevancyThreshold: 0,
      });

      const input = [
        { key: "Guide A", summary: "How to sort JavaScript arrays with Array.prototype.sort" },
        { key: "Guide B", summary: "Sorting arrays in JavaScript using a comparator function" },
        { key: "Guide C", summary: "JavaScript array sorting examples and best practices" },
      ];

      const out = await intent.filter("JavaScript array sorting", input);

      expect(out).toEqual(input);
    },
    30000,
  );

  test.concurrent(
    "explain=true returns { item, explanation } and still filters by threshold",
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

      expect(out.map((x) => x.item.key)).toEqual(["JS Arrays"]);
      expect(typeof out[0]?.explanation).toBe("string");
      expect(out[0]?.explanation.length).toBeGreaterThan(0);
    },
    30000,
  );

  test.concurrent(
    "supports custom extractors (nested objects)",
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
    "handles unicode keys and summaries",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
        relevancyThreshold: 0,
      });

      const out = await intent.rank("JavaScript array sorting", [
        { key: "Café", summary: "Guía para ordenar arrays en JavaScript" },
        { key: "東京", summary: "A travel guide to Tokyo neighborhoods" },
        { key: "Banana Bread", summary: "How to bake banana bread" },
      ]);

      expect(out.map((x) => x.key)).toEqual(["Café"]);
    },
    30000,
  );

  test.concurrent(
    "handles keys with punctuation, whitespace, and newlines",
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
        {
          key: "Unrelated",
          summary: "How to bake banana bread",
        },
      ]);

      expect(out.length).toBe(3);
      expect(out[0]?.key).toBe("Array.sort() / comparator");
      expect(out.some((x) => x.key === "Stable sort: ties, order")).toBe(true);
      expect(out.some((x) => x.key === "Key with spaces\n(and newline)")).toBe(true);
    },
    30000,
  );

  test.concurrent(
    "disambiguates duplicate keys",
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

      expect(out.map((x) => x.key)).toEqual(["Same", "Same"]);
    },
    30000,
  );

  test.concurrent(
    "supports non-default score ranges (minScore/maxScore)",
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
    "handles batching across multiple LLM calls",
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
        { key: "Moon Bases", summary: "Guide to living on the moon" },
      ];

      const out = await intent.rank("JavaScript array sorting", candidates);
      expect(out.map((x) => x.key)).toEqual([
        "Array.sort",
        "Comparator",
        "Stable sort",
        "Quickstart",
      ]);
    },
    60000,
  );

  test.concurrent(
    "handles larger candidate sets (stress)",
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
      expect(out.length).toBe(5);
      expect(out.map((x) => x.key)).toEqual(["Doc 1", "Doc 7", "Doc 13", "Doc 19", "Doc 25"]);
    },
    120000,
  );

  test.concurrent(
    "explain=true stays aligned with items across batches",
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

      expect(out.length).toBe(4);
      expect(out.map((r) => r.item.key)).toEqual(["Item 1", "Item 4", "Item 7", "Item 10"]);
      for (const r of out) {
        expect(typeof r.explanation).toBe("string");
        expect(r.explanation.length).toBeGreaterThan(0);
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

      expect(out.map((x) => x.key)).toEqual(["JS Arrays"]);
    },
    30000,
  );

  test.concurrent(
    "filter() returns only relevant items and preserves input order",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
      });

      const input = [
        { key: "A", summary: "How to bake banana bread" },
        { key: "B", summary: "Guide to sorting arrays in JavaScript" },
        { key: "C", summary: "JavaScript Array.prototype.sort examples" },
        { key: "D", summary: "History of the Eiffel Tower" },
      ];

      const out = await intent.filter("JavaScript array sorting", input);
      expect(out.map((x) => x.key)).toEqual(["B", "C"]);
    },
    30000,
  );

  test.concurrent(
    "README filter example: filters tools down to the relevant subset",
    async () => {
      type Tool = {
        name: string;
        description: string;
      };

      const intent = new Intent<Tool>({
        key: (t) => t.name,
        summary: (t) => t.description,
        timeoutMs: defaultTimeoutMs,
      });

      const tools: Tool[] = [
        { name: "search", description: "Search the web for up-to-date information" },
        { name: "sendEmail", description: "Send an email to a recipient" },
        { name: "runSQL", description: "Run a SQL query against the analytics DB" },
        { name: "createInvoice", description: "Create an invoice for a customer" },
      ];

      const task = "Find the customer's last invoice total and email it to them.";

      const relevantTools = await intent.filter(task, tools);

      // Filter is order-preserving, so we only assert membership.
      const names = relevantTools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(["sendEmail", "runSQL"]));
      expect(names).not.toEqual(expect.arrayContaining(["createInvoice"]));
    },
    30000,
  );

  test.concurrent(
    "filter({ explain: true }) returns aligned explanations",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
      });

      const input = [
        { key: "JS Arrays", summary: "Guide to sorting arrays in JavaScript" },
        { key: "Banana Bread", summary: "How to bake banana bread" },
      ];

      const out = await intent.filter("JavaScript array sorting", input, { explain: true });
      expect(out.length).toBe(1);
      expect(out[0]?.item.key).toBe("JS Arrays");
      expect(typeof out[0]?.explanation).toBe("string");
      expect(out[0]?.explanation.length).toBeGreaterThan(0);
    },
    30000,
  );

  test.concurrent(
    "choice() returns exactly one item from the input",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
        batchSize: 2,
        tinyBatchFraction: 0,
      });

      const input = [
        { key: "Banana Bread", summary: "How to bake banana bread" },
        { key: "JS Arrays", summary: "Guide to sorting arrays in JavaScript" },
        { key: "Eiffel Tower", summary: "History of the Eiffel Tower" },
        { key: "Comparator", summary: "How to write a comparator function in JS" },
      ];

      const winner = await intent.choice("JavaScript array sorting", input);
      expect(winner.key).toBe("JS Arrays");
    },
    60000,
  );

  test.concurrent(
    "choice({ explain: true }) returns { item, explanation }",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: defaultTimeoutMs,
        batchSize: 2,
        tinyBatchFraction: 0,
      });

      const input = [
        { key: "Banana Bread", summary: "How to bake banana bread" },
        { key: "JS Arrays", summary: "Guide to sorting arrays in JavaScript" },
        { key: "Comparator", summary: "How to write a comparator function in JS" },
      ];

      const res = await intent.choice("JavaScript array sorting", input, { explain: true });
      expect(res.item.key).toBe("JS Arrays");
      expect(typeof res.explanation).toBe("string");
      expect(res.explanation.length).toBeGreaterThan(0);
    },
    60000,
  );

  test.concurrent(
    "README choice example: routes to a best-fit model and explains why",
    async () => {
      type Model = {
        id: string;
        strengths: string;
      };

      const intent = new Intent<Model>({
        key: (m) => m.id,
        summary: (m) => m.strengths,
        timeoutMs: defaultTimeoutMs,
      });

      const models: Model[] = [
        {
          id: "gemini-3-pro",
          strengths: "Hard reasoning, math, complex debugging. Slower but very strong.",
        },
        {
          id: "gpt-5.2",
          strengths: "Best for code generation, refactors, feature implementation.",
        },
        {
          id: "haiku-4.5",
          strengths: "Fast and cheap. Good for triage and simple edits.",
        },
        {
          id: "nano-banana-pro",
          strengths: "Image generation and visual content.",
        },
      ];

      const task = "Implement a feature to add retries with exponential backoff and tests.";

      const { item: selected, explanation } = await intent.choice(task, models, { explain: true });

      expect(selected.id).toBe("gpt-5.2");
      expect(typeof explanation).toBe("string");
      expect(explanation.length).toBeGreaterThan(0);
    },
    60000,
  );
});

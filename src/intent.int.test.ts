import { describe, expect, test } from "vitest";

import { Intent } from "./intent";

describe("reranker integration", () => {
  test.concurrent(
    "reranker end-to-end",
    async () => {
      const intent = new Intent<{ key: string; summary: string }>({
        key: (x) => x.key,
        summary: (x) => x.summary,
        timeoutMs: 5000,
      });
      const out = await intent.rank("select the best doc", [
        { key: "Alpha", summary: "Doc about alpha" },
        { key: "Beta", summary: "Doc about beta" },
      ]);
      expect(out.length).toBeGreaterThanOrEqual(0);
      expect(out.length).toBeLessThanOrEqual(2);
    },
    20000,
  );
});

import { describe, expect, test } from "vitest";

import { CONFIG } from "./config";
import { Reranker } from "./reranker";

const hasKey = Boolean(CONFIG.GROQ.API_KEY);

describe.skipIf(!hasKey)("reranker integration", () => {
  test.concurrent(
    "reranker end-to-end",
    async () => {
      const reranker = new Reranker<{ key: string; summary: string }>(
        {},
        { key: (x) => x.key, summary: (x) => x.summary },
        { timeoutMs: 5000 },
      );
      const out = await reranker.rerank("select the best doc", [
        { key: "Alpha", summary: "Doc about alpha" },
        { key: "Beta", summary: "Doc about beta" },
      ]);
      expect(out.length).toBeGreaterThanOrEqual(0);
      expect(out.length).toBeLessThanOrEqual(2);
    },
    20000,
  );
});

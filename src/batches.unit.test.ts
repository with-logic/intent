import { describe, it, expect } from "vitest";

import { sliceIntoFixedBatches, mergeTinyFinalBatch, createBatches, batchProcess } from "./batches";

describe("batches helpers", () => {
  it("sliceIntoFixedBatches splits into fixed sizes with a remainder", () => {
    const items = Array.from({ length: 12 }, (_, i) => i + 1);
    const res = sliceIntoFixedBatches(items, 5);
    expect(res).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
      [11, 12],
    ]);
  });

  it("mergeTinyFinalBatch merges when the last batch is tiny and non-empty", () => {
    const batches = [[1, 2, 3, 4, 5], [6, 7], [8]]; // last size 1
    const out = mergeTinyFinalBatch(batches, 2); // threshold 2 -> 1 is tiny
    expect(out).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8],
    ]);
  });

  it("mergeTinyFinalBatch leaves alone when last is empty or larger than threshold", () => {
    expect(mergeTinyFinalBatch([[1, 2], []], 2)).toEqual([[1, 2], []]);
    expect(
      mergeTinyFinalBatch(
        [
          [1, 2],
          [3, 4, 5],
        ],
        2,
      ),
    ).toEqual([
      [1, 2],
      [3, 4, 5],
    ]);
  });

  it("mergeTinyFinalBatch no-ops when there is only one batch", () => {
    expect(mergeTinyFinalBatch([[1, 2, 3]], 2)).toEqual([[1, 2, 3]]);
  });

  it("createBatches merges a tiny trailing batch based on fraction", () => {
    const items = Array.from({ length: 12 }, (_, i) => i + 1); // 12
    // size=5 -> initial batches [5,5,2]; tinyFraction=0.25 -> ceil(1.25)=2 -> merge
    expect(createBatches(items, 5, 0.25)).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10, 11, 12],
    ]);
  });

  it("createBatches leaves intact when trailing batch exceeds tiny threshold", () => {
    const items = Array.from({ length: 13 }, (_, i) => i + 1); // 13 -> [5,5,3]
    // size=5 -> threshold ceil(1.25)=2, last=3 > 2 -> no merge
    expect(createBatches(items, 5, 0.25)).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
      [11, 12, 13],
    ]);
  });

  it("batchProcess splits, calls fn, catches errors, and flattens", async () => {
    const items = [1, 2, 3, 4, 5];
    // size=2, tinyFraction=0.25 -> batches [1,2], [3,4,5] (last tiny merges)
    const out = await batchProcess(items, 2, 0.25, async (b) => {
      if (b.includes(3)) throw new Error("boom");
      return b.map((x) => x * 2);
    });
    // First batch doubled, second batch failed -> original preserved
    expect(out).toEqual([2, 4, 3, 4, 5]);
  });
});

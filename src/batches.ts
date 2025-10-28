/**
 * Utilities for creating and maintaining batches of items.
 */

/**
 * Slice a list into fixed-size batches.
 *
 * Divides the input array into chunks of the specified size. The final batch
 * may be smaller than the requested size if items don't divide evenly.
 *
 * @param items - Array of items to batch
 * @param size - Maximum number of items per batch
 * @returns Array of batches, each containing up to `size` items
 */
export function sliceIntoFixedBatches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Merge the final batch into the previous when it's tiny (but non-empty).
 *
 * Small trailing batches are inefficient for LLM calls due to fixed overhead.
 * This function merges the last batch into the second-to-last when the final
 * batch is smaller than the threshold.
 *
 * @param batches - Array of batches to potentially merge
 * @param tinyThreshold - Maximum size for a batch to be considered "tiny"
 * @returns Modified array with tiny final batch merged, or original if no merge needed
 */
export function mergeTinyFinalBatch<T>(batches: T[][], tinyThreshold: number): T[][] {
  if (batches.length < 2) return batches;
  const last = batches[batches.length - 1]!;
  if (last.length === 0 || last.length > tinyThreshold) return batches;
  const prev = batches[batches.length - 2]!;
  batches[batches.length - 2] = prev.concat(last);
  batches.pop();
  return batches;
}

/**
 * Create batches then merge a tiny trailing batch.
 *
 * Combines sliceIntoFixedBatches and mergeTinyFinalBatch to efficiently
 * partition items while avoiding wasteful small final batches.
 *
 * @param items - Array of items to batch
 * @param size - Target batch size
 * @param tinyFraction - Fraction of batch size (0-1) below which final batch is merged
 * @returns Array of batches with no tiny trailing batch
 */
export function createBatches<T>(items: T[], size: number, tinyFraction: number): T[][] {
  const batches = sliceIntoFixedBatches(items, size);
  const tinyThreshold = Math.ceil(tinyFraction * size);
  return mergeTinyFinalBatch(batches, tinyThreshold);
}

import type { LoggerLike } from "./types";

/**
 * Split items into batches, process each batch with an async function, handle errors, and flatten results.
 *
 * Batches are processed in parallel using Promise.all. If a batch fails, the error
 * handler (or fallback to original items) is used for that batch, while successful
 * batches proceed normally.
 *
 * @param items - Array of items to process in batches
 * @param size - Target batch size
 * @param tinyFraction - Fraction of batch size below which final batch is merged
 * @param fn - Async function to process each batch
 * @param logger - Optional logger for warnings
 * @param onError - Optional error handler returning fallback results for failed batch
 * @returns Flattened array of all batch results
 */
export async function batchProcess<I, O = I>(
  items: I[],
  size: number,
  tinyFraction: number,
  fn: (batch: I[]) => Promise<O[]>,
  logger?: LoggerLike,
  onError?: (batch: I[], error: unknown) => O[],
): Promise<O[]> {
  const batches = createBatches<I>(items, size, tinyFraction);
  const results = await Promise.all(
    batches.map(async (b) => {
      try {
        return await fn(b);
      } catch (error) {
        logger?.warn?.("intent reranker batch failed, preserving original order", {
          error: (error as Error)?.message,
        });
        return onError ? onError(b, error) : (b as unknown as O[]);
      }
    }),
  );
  return results.flat();
}

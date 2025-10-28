import { batchProcess } from "./batches";
import { CONFIG } from "./config";
import { clamp } from "./lib/number";
import { selectLlmClient } from "./llm_client";
import { buildMessages } from "./messages";
import { buildRelevancySchema } from "./schema";

import type { JSONObject, RerankerExtractors, IntentContext, LlmClient } from "./types";

type RerankerConfig = typeof CONFIG.RERANKER;

/**
 * LLM-based reranker for arbitrary items.
 *
 * Uses a listwise LLM approach to score candidates 0-10 based on relevance to a query,
 * then filters by threshold and returns results sorted by score with stable ordering.
 *
 * @template T - The type of items to rerank
 *
 * @example
 * ```typescript
 * type Document = { id: string; title: string; content: string };
 *
 * const reranker = new Reranker<Document>(
 *   { llm: myClient, userId: "user-123" },
 *   {
 *     key: doc => doc.title,
 *     summary: doc => doc.content.slice(0, 200)
 *   },
 *   { RELEVANCY_THRESHOLD: 5, BATCH_SIZE: 20 }
 * );
 *
 * const ranked = await reranker.rerank("find expense reports", documents);
 * ```
 */
export class Reranker<T> {
  private readonly cfg: RerankerConfig;
  private readonly llm: LlmClient;

  /**
   * Creates a new Reranker instance.
   *
   * @param ctx - Context containing LLM client, optional logger, and user ID
   * @param ctx.llm - Optional LLM client. If omitted, will use Groq client if GROQ_API_KEY is set
   * @param ctx.logger - Optional logger for warnings and errors
   * @param ctx.userId - Optional user identifier passed to LLM provider for abuse monitoring
   * @param extractors - Functions to extract key and summary from items
   * @param extractors.key - Required function returning a short human-readable identifier
   * @param extractors.summary - Optional function returning a short description for LLM reasoning
   * @param overrides - Optional config overrides for model, timeout, threshold, and batch settings
   * @throws {Error} If no LLM client is provided and GROQ_API_KEY is not set
   */
  constructor(
    private readonly ctx: IntentContext,
    private readonly extractors: RerankerExtractors<T>,
    overrides: Partial<RerankerConfig> = {},
  ) {
    this.cfg = { ...CONFIG.RERANKER, ...overrides };

    // Validate threshold is in valid range
    if (this.cfg.RELEVANCY_THRESHOLD < 0 || this.cfg.RELEVANCY_THRESHOLD > 10) {
      throw new Error(
        `intent: RELEVANCY_THRESHOLD must be between 0 and 10, got ${this.cfg.RELEVANCY_THRESHOLD}`,
      );
    }

    const selectedClient = selectLlmClient(ctx);
    if (!selectedClient) {
      throw new Error(
        "intent: No LLM client provided and GROQ_API_KEY not set. Provide ctx.llm or set GROQ_API_KEY.",
      );
    }
    this.llm = selectedClient;
  }

  /**
   * Rerank candidates based on relevance to a query.
   *
   * Calls the LLM to score each candidate 0-10 based on relevance to the query,
   * filters results by the configured threshold, and returns items sorted by score
   * (highest first) with ties preserving original input order.
   *
   * Fast-path optimizations:
   * - Returns empty array for 0 candidates without LLM call
   * - Returns single candidate unchanged without LLM call
   *
   * Error handling:
   * - On any batch error, returns that batch's items in original order
   * - On top-level error, returns all items in original order
   * - All errors are logged via the configured logger
   *
   * @param query - The search query or user intent to rank against
   * @param candidates - Array of items to rerank
   * @param options - Optional per-call configuration
   * @param options.userId - Optional user ID for this specific call, overrides ctx.userId
   * @returns Filtered and sorted array of items, or original order on any error
   *
   * @example
   * ```typescript
   * const results = await reranker.rerank(
   *   "quarterly expense reports from 2024",
   *   allDocuments,
   *   { userId: "session-abc" }
   * );
   * // Returns only documents with score > threshold, sorted by relevance
   * ```
   */
  public async rerank(query: string, candidates: T[], options?: { userId?: string }): Promise<T[]> {
    try {
      if (candidates.length === 0) return [];
      if (candidates.length === 1) return candidates;

      const prepared = this.prepareCandidates(candidates);
      return await batchProcess(
        prepared,
        this.cfg.BATCH_SIZE,
        this.cfg.TINY_BATCH_FRACTION,
        (batch) => this.processBatch(query, batch, options?.userId),
        this.ctx.logger,
        (batch) => batch.map(({ item }) => item),
      );
    } catch (error) {
      this.ctx.logger?.warn?.("intent reranker failed, using fallback", {
        error: (error as Error)?.message,
      });
      return candidates;
    }
  }

  /**
   * Normalize incoming items into a consistent shape for downstream processing.
   *
   * Extracts the key and summary from each item using the configured extractors,
   * and attaches the original input index for stable sorting later.
   *
   * @param candidates - Raw items to prepare
   * @returns Array of prepared candidates with extracted metadata and original index
   * @private
   */
  private prepareCandidates(candidates: T[]): Array<{
    item: T;
    idx: number;
    baseKey: string;
    summary: string;
  }> {
    return candidates.map((item, idx) => ({
      item,
      idx,
      baseKey: this.extractors.key(item),
      summary: this.extractors.summary?.(item) ?? "",
    }));
  }

  /**
   * Ensure keys are unique by suffixing duplicates with their input index.
   *
   * When multiple items share the same key, subsequent occurrences are renamed
   * to "Key (idx)" where idx is the original input index. This prevents JSON
   * schema validation errors and ensures the LLM can score each item independently.
   *
   * @param itemsBase - Prepared candidates with potentially duplicate keys
   * @returns Candidates with guaranteed unique keys
   * @private
   */
  private ensureUniqueKeys(
    itemsBase: Array<{ item: T; idx: number; baseKey: string; summary: string }>,
  ): Array<{ item: T; idx: number; key: string; summary: string }> {
    const counts = new Map<string, number>();
    return itemsBase.map(({ item, baseKey, summary, idx }) => {
      const n = (counts.get(baseKey) ?? 0) + 1;
      counts.set(baseKey, n);
      const key = n === 1 ? baseKey : `${baseKey} (${idx})`;
      return { item, idx, key, summary };
    });
  }

  /**
   * Build the JSON schema and chat messages payload for the LLM.
   *
   * Creates a strict JSON schema requiring one integer property (0-10) per candidate key,
   * and constructs system + user messages instructing the LLM to score relevance.
   *
   * @param query - The search query to evaluate candidates against
   * @param items - Candidates with unique keys and summaries
   * @returns Object containing JSON schema and chat messages array
   * @private
   */
  private buildRequest(
    query: string,
    items: Array<{ key: string; summary: string }>,
  ): { schema: JSONObject; messages: any[] } {
    const keys = items.map((x) => x.key);
    const schema: JSONObject = buildRelevancySchema(keys);
    const messages = buildMessages(query, items);
    return { schema, messages };
  }

  /**
   * Invoke the LLM and return the parsed map of candidate scores.
   *
   * Calls the configured LLM client with the messages, JSON schema, model config,
   * and user ID. Returns null if the response is invalid or missing.
   *
   * @param messages - Chat messages (system + user) to send to LLM
   * @param schema - Strict JSON schema defining expected response structure
   * @param userId - Optional user identifier for provider abuse monitoring
   * @returns Map of candidate keys to numeric scores, or null if response invalid
   * @private
   */
  private async fetchScores(
    messages: any[],
    schema: JSONObject,
    userId?: string,
  ): Promise<Record<string, number> | null> {
    const { data } = await this.llm.call<Record<string, number>>(
      messages,
      schema,
      { model: this.cfg.MODEL, temperature: 0, timeoutMs: this.cfg.TIMEOUT_MS },
      userId ?? this.ctx.userId,
    );

    if (data == null || typeof data !== "object") return null;
    return data as Record<string, number>;
  }

  /**
   * Apply relevancy threshold filtering and stable sorting.
   *
   * Scores are clamped to 0-10 range, then filtered to keep only items with
   * score > threshold. Results are sorted by score descending, with ties
   * preserving original input order for deterministic results.
   *
   * @param items - Candidates with unique keys
   * @param scores - Map of candidate keys to LLM-assigned scores
   * @returns Filtered and sorted array of original items
   * @private
   */
  private rankAndFilter(
    items: Array<{ item: T; idx: number; key: string; summary: string }>,
    scores: Record<string, number>,
  ): T[] {
    const threshold = this.cfg.RELEVANCY_THRESHOLD;
    const scored = items.map(({ item, idx, key }) => ({
      item,
      idx,
      score: clamp((scores as any)[key], 0, 10),
    }));

    const filtered = scored.filter(({ score }) => score > threshold);
    const sorted = filtered.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.idx - b.idx;
    });
    return sorted.map(({ item }) => item);
  }

  /**
   * Process a single batch of candidates through the LLM.
   *
   * Ensures unique keys, builds the request payload, fetches scores from the LLM,
   * and returns filtered and sorted results. On any error or null response from
   * the LLM, returns items in their original order as a fallback.
   *
   * @param query - The search query to evaluate candidates against
   * @param batch - Batch of prepared candidates to process
   * @param userId - Optional user identifier for provider abuse monitoring
   * @returns Ranked and filtered items, or original order on error
   * @private
   */
  private async processBatch(
    query: string,
    batch: Array<{ item: T; idx: number; baseKey: string; summary: string }>,
    userId?: string,
  ): Promise<T[]> {
    const keyed = this.ensureUniqueKeys(batch);
    const { schema, messages } = this.buildRequest(query, keyed);
    const scores = await this.fetchScores(messages, schema, userId);
    if (scores == null) return keyed.map(({ item }) => item);
    return this.rankAndFilter(keyed, scores);
  }
}

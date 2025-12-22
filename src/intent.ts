import { batchProcess } from "./batches";
import { CONFIG } from "./config";
import { DEFAULT_KEY_EXTRACTOR, DEFAULT_SUMMARY_EXTRACTOR } from "./extractors";
import { clamp } from "./lib/number";
import { selectLlmClient } from "./llm_client";
import { buildMessages } from "./messages";
import { buildRelevancySchema } from "./schema";

import type {
  ChatMessage,
  JSONObject,
  IntentOptions,
  IntentConfig,
  LlmClient,
  LlmCallConfig,
  IntentContext,
  IntentExtractors,
} from "./types";

/**
 * LLM-based reranker for arbitrary items.
 *
 * Uses a listwise LLM approach to score candidates 0-10 based on relevance to a query,
 * then filters by threshold and returns results sorted by score with stable ordering.
 *
 * @template T - The type of items to rerank (defaults to any)
 *
 * @example
 * ```typescript
 * // Simplest: uses defaults and GROQ_API_KEY from environment
 * const intent = new Intent();
 * const ranked = await intent.rank("find expense reports", items);
 *
 * // With custom extractors
 * type Document = { id: string; title: string; content: string };
 * const intent = new Intent<Document>({
 *   key: doc => doc.title,
 *   summary: doc => doc.content.slice(0, 200),
 *   relevancyThreshold: 5,
 *   batchSize: 20
 * });
 *
 * // With custom LLM client
 * const intent = new Intent<Document>({
 *   llm: myClient,
 *   userId: "user-123",
 *   key: doc => doc.title,
 *   summary: doc => doc.content.slice(0, 200)
 * });
 * ```
 */
export class Intent<T = any> {
  private readonly cfg: Required<IntentConfig>;
  private readonly llm: LlmClient;
  private readonly ctx: IntentContext;
  private readonly extractors: Required<IntentExtractors<T>>;
  private readonly env: typeof CONFIG;

  /**
   * Builds the context object from options.
   *
   * Constructs an IntentContext with only defined properties to satisfy
   * TypeScript's exactOptionalPropertyTypes requirement.
   *
   * @param options - The options object containing llm, logger, and userId
   * @returns IntentContext with only defined properties
   * @private
   */
  private buildContext(options: IntentOptions<T>): IntentContext {
    return {
      ...(options.llm !== undefined && { llm: options.llm }),
      ...(options.logger !== undefined && { logger: options.logger }),
      ...(options.userId !== undefined && { userId: options.userId }),
    };
  }

  /**
   * Builds the extractors object from options.
   *
   * Uses provided extractors or falls back to generic defaults that work
   * for any type T via JSON stringification and hashing.
   *
   * @param options - The options object containing key and summary extractors
   * @returns Required extractors with defaults applied
   * @private
   */
  private buildExtractors(options: IntentOptions<T>): Required<IntentExtractors<T>> {
    return {
      key: options.key ?? DEFAULT_KEY_EXTRACTOR<T>,
      summary: options.summary ?? DEFAULT_SUMMARY_EXTRACTOR<T>,
    };
  }

  /**
   * Builds the configuration object from options.
   *
   * Merges user-provided options with environment-based CONFIG defaults.
   *
   * @param options - The options object containing config overrides
   * @returns Required config with all values populated
   * @private
   */
  private buildConfig(options: IntentOptions<T>): Required<IntentConfig> {
    return {
      model: options.model ?? this.env.INTENT.MODEL,
      timeoutMs: options.timeoutMs ?? this.env.INTENT.TIMEOUT_MS,
      relevancyThreshold: options.relevancyThreshold ?? this.env.INTENT.RELEVANCY_THRESHOLD,
      batchSize: options.batchSize ?? this.env.INTENT.BATCH_SIZE,
      tinyBatchFraction: options.tinyBatchFraction ?? this.env.INTENT.TINY_BATCH_FRACTION,
    };
  }

  /**
   * Validates the configuration values.
   *
   * Ensures relevancyThreshold is within the valid 0-10 range.
   *
   * @throws {Error} If relevancyThreshold is not between 0 and 10
   * @private
   */
  private validateConfig(): void {
    if (this.cfg.relevancyThreshold < 0 || this.cfg.relevancyThreshold > 10) {
      throw new Error(
        `intent: relevancyThreshold must be between 0 and 10, got ${this.cfg.relevancyThreshold}`,
      );
    }
  }

  /**
   * Selects and validates the LLM client.
   *
   * Uses the provided client from context or attempts to create a default
   * Groq client if GROQ_API_KEY is available.
   *
   * @returns The selected LLM client
   * @throws {Error} If no LLM client is provided and GROQ_API_KEY is not set
   * @private
   */
  private selectAndValidateLlmClient(): LlmClient {
    const selectedClient = selectLlmClient(this.ctx, this.env);
    if (!selectedClient) {
      throw new Error(
        "intent: No LLM client provided and GROQ_API_KEY not set. Provide options.llm or set GROQ_API_KEY.",
      );
    }
    return selectedClient;
  }

  /**
   * Creates a new Intent instance.
   *
   * All options are optional with sensible defaults:
   * - llm: Auto-detected from GROQ_API_KEY environment variable if available
   * - key: Hash-based string from JSON representation of items
   * - summary: Pretty-printed JSON of items (2-space indentation for LLM readability)
   * - Config values: From INTENT_* environment variables or built-in defaults
   *
   * @param options - Optional configuration object
   * @param options.llm - Optional LLM client. If omitted, uses Groq client when GROQ_API_KEY is set
   * @param options.logger - Optional logger for warnings and errors
   * @param options.userId - Optional user identifier for LLM provider abuse monitoring
   * @param options.key - Optional function extracting a short human-readable key from items
   * @param options.summary - Optional function extracting a short description for LLM reasoning
   * @param options.model - Optional model name override (default: INTENT_MODEL or "openai/gpt-oss-20b")
   * @param options.timeoutMs - Optional timeout in milliseconds (default: INTENT_TIMEOUT_MS or 3000)
   * @param options.relevancyThreshold - Optional minimum score 0-10 to include results (default: INTENT_RELEVANCY_THRESHOLD or 0)
   * @param options.batchSize - Optional number of candidates per LLM call (default: INTENT_BATCH_SIZE or 20)
   * @param options.tinyBatchFraction - Optional threshold for merging small batches (default: INTENT_TINY_BATCH_FRACTION or 0.2)
   * @throws {Error} If no LLM client is provided and GROQ_API_KEY is not set
   * @throws {Error} If relevancyThreshold is not between 0 and 10
   *
   * @example
   * ```typescript
   * // Minimal - uses all defaults
   * const intent = new Intent();
   *
   * // With extractors
   * const intent = new Intent<Doc>({
   *   key: doc => doc.title,
   *   summary: doc => doc.content
   * });
   *
   * // Full configuration
   * const intent = new Intent<Doc>({
   *   llm: myClient,
   *   userId: "org-123",
   *   key: doc => doc.title,
   *   summary: doc => doc.content,
   *   relevancyThreshold: 5,
   *   batchSize: 20
   * });
   * ```
   */
  constructor(options: IntentOptions<T> & { config?: typeof CONFIG } = {}) {
    this.env = options.config ?? CONFIG;
    this.ctx = this.buildContext(options);
    this.extractors = this.buildExtractors(options);
    this.cfg = this.buildConfig(options);

    this.validateConfig();
    this.llm = this.selectAndValidateLlmClient();
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
   * const results = await intent.rank(
   *   "quarterly expense reports from 2024",
   *   allDocuments,
   *   { userId: "session-abc" }
   * );
   * // Returns only documents with score > threshold, sorted by relevance
   * ```
   */
  public async rank(query: string, candidates: T[], options?: { userId?: string }): Promise<T[]> {
    try {
      if (candidates.length === 0) return [];
      if (candidates.length === 1) return candidates;

      const prepared = this.prepareCandidates(candidates);
      return await batchProcess(
        prepared,
        this.cfg.batchSize,
        this.cfg.tinyBatchFraction,
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
      summary: this.extractors.summary(item),
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
  ): { schema: JSONObject; messages: ChatMessage[] } {
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
    messages: ChatMessage[],
    schema: JSONObject,
    userId?: string,
  ): Promise<Record<string, number> | null> {
    const config: LlmCallConfig = {
      model: this.cfg.model,
      temperature: 0,
      timeoutMs: this.cfg.timeoutMs,
    };
    const { data } = await this.llm.call<Record<string, number>>(
      messages,
      schema,
      config,
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
    const threshold = this.cfg.relevancyThreshold;
    const scored = items.map(({ item, idx, key }) => ({
      item,
      idx,
      score: clamp(scores[key] ?? 0, 0, 10),
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

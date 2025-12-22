import { batchProcess } from "./batches";
import { CONFIG } from "./config";
import { DEFAULT_KEY_EXTRACTOR, DEFAULT_SUMMARY_EXTRACTOR } from "./extractors";
import { clamp } from "./lib/number";
import { selectLlmClient } from "./llm_client";
import { buildChoiceMessages, buildFilterMessages, buildMessages } from "./messages";
import { buildChoiceSchema, buildFilterSchema, buildRelevancySchema } from "./schema";

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
 * Uses a listwise LLM approach to score candidates within a configurable range based on relevance to a query,
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
   * Resolve the model name to use for this Intent instance.
   *
   * Intent is provider-driven. Today only GROQ is supported; when using GROQ
   * we always take the model from GROQ's config defaults.
   *
   * @returns Provider-specific model name
   * @private
   */
  private resolveModel(): string {
    return this.env.GROQ.DEFAULT_MODEL;
  }

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
      provider: options.provider ?? this.env.INTENT.PROVIDER,
      timeoutMs: options.timeoutMs ?? this.env.INTENT.TIMEOUT_MS,
      relevancyThreshold: options.relevancyThreshold ?? this.env.INTENT.RELEVANCY_THRESHOLD,
      batchSize: options.batchSize ?? this.env.INTENT.BATCH_SIZE,
      tinyBatchFraction: options.tinyBatchFraction ?? this.env.INTENT.TINY_BATCH_FRACTION,
      minScore: options.minScore ?? this.env.INTENT.MIN_SCORE,
      maxScore: options.maxScore ?? this.env.INTENT.MAX_SCORE,
    };
  }

  /**
   * Validates the configuration values.
   *
   * Ensures the configured score range is valid and the relevancyThreshold is in range.
   *
   * @throws {Error} If maxScore is below minScore
   * @throws {Error} If relevancyThreshold is not within [minScore, maxScore]
   * @private
   */
  private validateConfig(): void {
    if (this.cfg.maxScore < this.cfg.minScore) {
      throw new Error(
        `intent: maxScore must be >= minScore, got minScore=${this.cfg.minScore} maxScore=${this.cfg.maxScore}`,
      );
    }

    if (
      this.cfg.relevancyThreshold < this.cfg.minScore ||
      this.cfg.relevancyThreshold > this.cfg.maxScore
    ) {
      throw new Error(
        `intent: relevancyThreshold must be between ${this.cfg.minScore} and ${this.cfg.maxScore}, got ${this.cfg.relevancyThreshold}`,
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
   * @param options.provider - Optional provider override (default: INTENT_PROVIDER or "GROQ")
   * @param options.timeoutMs - Optional timeout in milliseconds (default: INTENT_TIMEOUT_MS or 3000)
   * @param options.relevancyThreshold - Optional minimum score to include results (default: INTENT_RELEVANCY_THRESHOLD)
   * @param options.minScore - Optional minimum score value (default: INTENT_MIN_SCORE or 0)
   * @param options.maxScore - Optional maximum score value (default: INTENT_MAX_SCORE or 10)
   * @param options.batchSize - Optional number of candidates per LLM call (default: INTENT_BATCH_SIZE or 20)
   * @param options.tinyBatchFraction - Optional threshold for merging small batches (default: INTENT_TINY_BATCH_FRACTION or 0.2)
   * @throws {Error} If no LLM client is provided and GROQ_API_KEY is not set
   * @throws {Error} If maxScore is below minScore
   * @throws {Error} If relevancyThreshold is not within [minScore, maxScore]
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
   * Calls the LLM to evaluate each candidate and returns only those above the
   * configured threshold, sorted by score (desc) with stable ordering on ties.
   *
   * The LLM is instructed to always generate an explanation before the score.
   * Explanations are only returned when `options.explain` is true.
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
   * @param options.explain - When true, return `{ item, explanation }[]` instead of `T[]`
   * @param options.userId - Optional user ID for this specific call, overrides ctx.userId
   * @returns Filtered and sorted array of items, or original order on any error
   *
   * @example
   * ```typescript
   * const itemsOnly = await intent.rank("find expense reports", docs);
   *
   * const withExplanations = await intent.rank("find expense reports", docs, { explain: true });
   * // => [{ item: Doc, explanation: string }, ...]
   * ```
   */
  public async rank(
    query: string,
    candidates: T[],
    options?: { explain?: false; userId?: string },
  ): Promise<T[]>;

  public async rank(
    query: string,
    candidates: T[],
    options: { explain: true; userId?: string },
  ): Promise<Array<{ item: T; explanation: string }>>;

  public async rank(
    query: string,
    candidates: T[],
    options?: { explain?: boolean; userId?: string },
  ): Promise<T[] | Array<{ item: T; explanation: string }>> {
    try {
      if (candidates.length === 0) {
        return [];
      }

      if (candidates.length === 1) {
        if (options?.explain) {
          const [firstCandidate] = candidates;
          return [{ item: firstCandidate!, explanation: "" }];
        }
        return candidates;
      }

      const prepared = this.prepareCandidates(candidates);

      const rankedWithExplanations = await batchProcess(
        prepared,
        this.cfg.batchSize,
        this.cfg.tinyBatchFraction,
        async (batch) =>
          (await this.processBatch(
            query,
            batch,
            options?.userId !== undefined ? { userId: options.userId } : undefined,
          )) as Array<{ item: T; explanation: string }>,
        this.ctx.logger,
        (batch) => batch.map(({ item }) => ({ item, explanation: "" })),
      );

      if (options?.explain) {
        return rankedWithExplanations;
      }

      return rankedWithExplanations.map(({ item }) => item);
    } catch (error) {
      this.ctx.logger?.warn?.("intent reranker failed, using fallback", {
        error: (error as Error)?.message,
      });

      if (options?.explain) {
        return candidates.map((item) => ({ item, explanation: "" }));
      }
      return candidates;
    }
  }

  /**
   * Filter candidates based on relevance to a query.
   *
   * Calls the LLM to decide whether each candidate is relevant, then returns
   * only the relevant items in the same order they were provided.
   *
   * Explanations are only returned when `options.explain` is true.
   *
   * Fast paths:
   * - Returns [] for 0 candidates without LLM call
   * - Returns the single candidate unchanged without LLM call
   *
   * Error handling:
   * - On any batch error, preserves that batch's original order
   * - On top-level error, preserves original order
   *
   * @param query - The search query or user intent to filter against
   * @param candidates - Array of items to filter
   * @param options - Optional per-call configuration
   * @param options.explain - When true, return `{ item, explanation }[]` instead of `T[]`
   * @param options.userId - Optional user ID for this specific call, overrides ctx.userId
   * @returns Filtered array of items, preserving input order
   */
  public async filter(
    query: string,
    candidates: T[],
    options?: { explain?: false; userId?: string },
  ): Promise<T[]>;

  public async filter(
    query: string,
    candidates: T[],
    options: { explain: true; userId?: string },
  ): Promise<Array<{ item: T; explanation: string }>>;

  public async filter(
    query: string,
    candidates: T[],
    options?: { explain?: boolean; userId?: string },
  ): Promise<T[] | Array<{ item: T; explanation: string }>> {
    if (candidates.length === 0) {
      return [];
    }

    if (candidates.length === 1) {
      if (options?.explain) {
        const [firstCandidate] = candidates;
        return [{ item: firstCandidate!, explanation: "" }];
      }
      return candidates;
    }

    const prepared = this.prepareCandidates(candidates);

    const filteredWithExplanations = await batchProcess(
      prepared,
      this.cfg.batchSize,
      this.cfg.tinyBatchFraction,
      async (batch) =>
        (await this.processFilterBatch(
          query,
          batch,
          options?.userId !== undefined ? { userId: options.userId } : undefined,
        )) as Array<{ item: T; explanation: string }>,
      this.ctx.logger,
      (batch) => batch.map(({ item }) => ({ item, explanation: "" })),
    );

    if (options?.explain) {
      return filteredWithExplanations;
    }

    return filteredWithExplanations.map(({ item }) => item);
  }

  /**
   * Choose exactly one candidate as the best match for a query.
   *
   * Uses a tournament strategy when inputs exceed the batch size:
   * - Choose one from each batch
   * - Then choose one from the batch winners
   *
   * This method always returns a single item.
   *
   * @param query - The search query or user intent
   * @param candidates - Array of items to choose from
   * @param options - Optional per-call configuration
   * @param options.explain - When true, return `{ item, explanation }` instead of `T`
   * @param options.userId - Optional user ID for this specific call, overrides ctx.userId
   * @returns The single chosen item (or item + explanation)
   */
  public async choice(
    query: string,
    candidates: T[],
    options?: { explain?: false; userId?: string },
  ): Promise<T>;

  public async choice(
    query: string,
    candidates: T[],
    options: { explain: true; userId?: string },
  ): Promise<{ item: T; explanation: string }>;

  public async choice(
    query: string,
    candidates: T[],
    options?: { explain?: boolean; userId?: string },
  ): Promise<T | { item: T; explanation: string }> {
    if (candidates.length === 0) {
      throw new Error("intent: choice requires at least one candidate");
    }

    if (candidates.length === 1) {
      const [firstCandidate] = candidates;
      if (options?.explain) {
        return { item: firstCandidate!, explanation: "" };
      }
      return firstCandidate!;
    }

    const prepared = this.prepareCandidates(candidates);
    const keyed = this.ensureUniqueKeys(prepared);

    const winners = await batchProcess(
      keyed,
      this.cfg.batchSize,
      this.cfg.tinyBatchFraction,
      async (batch) => [await this.processChoiceBatch(query, batch, options?.userId)],
      this.ctx.logger,
      (batch) => [{ item: batch[0]!.item, explanation: "" }],
    );

    // batchProcess guarantees at least one winner via its per-batch fallback.

    if (winners.length === 1) {
      const [onlyWinner] = winners;
      if (options?.explain) {
        return onlyWinner!;
      }
      return onlyWinner!.item;
    }

    const preparedFinalists = this.prepareCandidates(winners.map((w) => w.item));
    const keyedFinalists = this.ensureUniqueKeys(preparedFinalists);

    const final = await this.processChoiceBatch(query, keyedFinalists, options?.userId);
    if (options?.explain) {
      return final;
    }
    return final.item;
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
   * Creates a strict JSON schema requiring one integer property (minScore-maxScore) per candidate key,
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
    const schema: JSONObject = buildRelevancySchema(keys, this.cfg.minScore, this.cfg.maxScore);
    const messages = buildMessages(query, items, {
      minScore: this.cfg.minScore,
      maxScore: this.cfg.maxScore,
    });
    return { schema, messages };
  }

  /**
   * Build the JSON schema and chat messages payload for the LLM filter call.
   *
   * @param query - The search query to evaluate candidates against
   * @param items - Candidates with unique keys and summaries
   * @returns Object containing JSON schema and chat messages array
   * @private
   */
  private buildFilterRequest(
    query: string,
    items: Array<{ key: string; summary: string }>,
  ): { schema: JSONObject; messages: ChatMessage[] } {
    const keys = items.map((x) => x.key);
    const schema: JSONObject = buildFilterSchema(keys);
    const messages = buildFilterMessages(query, items);
    return { schema, messages };
  }

  /**
   * Build the JSON schema and chat messages payload for the LLM choice call.
   *
   * @param query - The search query to choose against
   * @param items - Candidates with unique keys and summaries
   * @returns Object containing JSON schema and chat messages array
   * @private
   */
  private buildChoiceRequest(
    query: string,
    items: Array<{ key: string; summary: string }>,
  ): { schema: JSONObject; messages: ChatMessage[] } {
    const keys = items.map((x) => x.key);
    const schema: JSONObject = buildChoiceSchema(keys);
    const messages = buildChoiceMessages(query, items);
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
  private async fetchEvaluations(
    messages: ChatMessage[],
    schema: JSONObject,
    userId?: string,
  ): Promise<Record<string, { explanation: string; score: number }> | null> {
    const config: LlmCallConfig = {
      model: this.resolveModel(),
      reasoningEffort: "medium",
      timeoutMs: this.cfg.timeoutMs,
    };
    const { data } = await this.llm.call<Record<string, { explanation: string; score: number }>>(
      messages,
      schema,
      config,
      userId ?? this.ctx.userId,
    );

    if (data == null || typeof data !== "object") return null;
    return data as Record<string, { explanation: string; score: number }>;
  }

  /**
   * Invoke the LLM and return boolean relevancy decisions.
   *
   * @param messages - Chat messages to send
   * @param schema - Strict JSON schema defining expected response structure
   * @param userId - Optional user id
   * @returns Map of candidate keys to filter decisions, or null if invalid
   * @private
   */
  private async fetchFilterDecisions(
    messages: ChatMessage[],
    schema: JSONObject,
    userId?: string,
  ): Promise<Record<string, { explanation: string; isRelevant: boolean }> | null> {
    const config: LlmCallConfig = {
      model: this.resolveModel(),
      reasoningEffort: "medium",
      timeoutMs: this.cfg.timeoutMs,
    };
    const { data } = await this.llm.call<
      Record<string, { explanation: string; isRelevant: boolean }>
    >(messages, schema, config, userId ?? this.ctx.userId);

    if (data == null || typeof data !== "object") return null;
    return data as Record<string, { explanation: string; isRelevant: boolean }>;
  }

  /**
   * Invoke the LLM and return a single selected key.
   *
   * @param messages - Chat messages to send
   * @param schema - Strict JSON schema defining expected response structure
   * @param userId - Optional user id
   * @returns Choice result, or null if invalid
   * @private
   */
  private async fetchChoice(
    messages: ChatMessage[],
    schema: JSONObject,
    userId?: string,
  ): Promise<{ explanation: string; selectedKey: string } | null> {
    const config: LlmCallConfig = {
      model: this.resolveModel(),
      reasoningEffort: "medium",
      timeoutMs: this.cfg.timeoutMs,
    };
    const { data } = await this.llm.call<{ explanation: string; selectedKey: string }>(
      messages,
      schema,
      config,
      userId ?? this.ctx.userId,
    );

    if (data == null || typeof data !== "object") return null;
    const record = data as Record<string, unknown>;
    const explanation = typeof record.explanation === "string" ? record.explanation : "";
    const selectedKey = typeof record.selectedKey === "string" ? record.selectedKey : "";
    if (selectedKey === "") return null;
    return { explanation, selectedKey };
  }

  /**
   * Apply boolean filter decisions while preserving input order.
   *
   * @param items - Candidates with unique keys
   * @param decisions - Map of candidate keys to decisions
   * @returns Filtered items with explanations
   * @private
   */
  private applyFilter(
    items: Array<{ item: T; idx: number; key: string; summary: string }>,
    decisions: Record<string, { explanation: string; isRelevant: boolean }>,
  ): Array<{ item: T; explanation: string }> {
    const kept: Array<{ item: T; explanation: string }> = [];
    for (const it of items) {
      const decision = decisions[it.key];
      if (decision?.isRelevant === true) {
        kept.push({
          item: it.item,
          explanation: typeof decision.explanation === "string" ? decision.explanation : "",
        });
      }
    }
    return kept;
  }

  /**
   * Process a single batch of candidates through the LLM filter.
   *
   * @param query - Query to filter against
   * @param batch - Prepared candidates
   * @param options - Optional userId override
   * @returns Filtered items (stable order), with explanations
   * @private
   */
  private async processFilterBatch(
    query: string,
    batch: Array<{ item: T; idx: number; baseKey: string; summary: string }>,
    options?: { userId?: string },
  ): Promise<Array<{ item: T; explanation: string }>> {
    const keyed = this.ensureUniqueKeys(batch);
    const { schema, messages } = this.buildFilterRequest(query, keyed);
    const decisions = await this.fetchFilterDecisions(messages, schema, options?.userId);
    if (decisions == null) {
      return keyed.map(({ item }) => ({ item, explanation: "" }));
    }

    return this.applyFilter(keyed, decisions);
  }

  /**
   * Process a batch of candidates and choose a single winner.
   *
   * @param query - Query to choose against
   * @param batch - Candidates with unique keys
   * @param userId - Optional userId override
   * @returns Winner item with explanation
   * @private
   */
  private async processChoiceBatch(
    query: string,
    batch: Array<{ item: T; idx: number; key: string; summary: string }>,
    userId?: string,
  ): Promise<{ item: T; explanation: string }> {
    const { schema, messages } = this.buildChoiceRequest(query, batch);
    const choice = await this.fetchChoice(messages, schema, userId);
    if (choice == null) {
      return { item: batch[0]!.item, explanation: "" };
    }

    const winner = batch.find((x) => x.key === choice.selectedKey);
    if (!winner) {
      return { item: batch[0]!.item, explanation: choice.explanation };
    }

    return { item: winner.item, explanation: choice.explanation };
  }

  /**
   * Apply relevancy threshold filtering and stable sorting.
   *
   * Scores are clamped to the configured score range, then filtered to keep only items with
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
    evaluations: Record<string, { explanation: string; score: number }>,
  ): Array<{ item: T; explanation: string; score: number }> {
    const threshold = this.cfg.relevancyThreshold;
    const scored = items.map(({ item, idx, key }) => ({
      item,
      idx,
      explanation:
        typeof evaluations[key]?.explanation === "string" ? evaluations[key].explanation : "",
      score: clamp(
        evaluations[key]?.score ?? this.cfg.minScore,
        this.cfg.minScore,
        this.cfg.maxScore,
      ),
    }));

    const filtered = scored.filter(({ score }) => score > threshold);
    const sorted = filtered.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.idx - b.idx;
    });
    return sorted;
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
    options?: { userId?: string },
  ): Promise<Array<{ item: T; explanation: string }>> {
    const keyed = this.ensureUniqueKeys(batch);
    const { schema, messages } = this.buildRequest(query, keyed);
    const evaluations = await this.fetchEvaluations(messages, schema, options?.userId);
    if (evaluations == null) {
      return keyed.map(({ item }) => ({ item, explanation: "" }));
    }

    const ranked = this.rankAndFilter(keyed, evaluations);
    return ranked.map(({ item, explanation }) => ({ item, explanation }));
  }
}

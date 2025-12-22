export type JSONPrimitive = boolean | number | string | null;
export type JSONValue = JSONPrimitive | JSONObject | JSONArray;
export type JSONObject = { [key: string]: JSONValue };
export type JSONArray = JSONValue[];

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type LlmCallConfig = {
  model?: string;
  temperature?: number;
  timeoutMs?: number;
};

export interface LlmClient {
  call<T>(
    messages: ChatMessage[],
    outputSchema: JSONObject,
    config?: LlmCallConfig,
    userId?: string,
  ): Promise<{ data: T }>;
}

export interface LoggerLike {
  info?(msg: string, meta?: unknown): void;
  warn?(msg: string, meta?: unknown): void;
  error?(msg: string, meta?: unknown): void;
}

export type IntentCandidate = {
  key: string;
  summary: string;
};

export type IntentExtractors<T> = {
  key?: (item: T) => string;
  summary?: (item: T) => string;
};

export type IntentContext = {
  llm?: LlmClient; // if omitted and GROQ_API_KEY present, a Groq client is used
  logger?: LoggerLike;
  userId?: string; // optional per-instance user id used for provider abuse monitoring
};

// Utility types for key-case transformations
export type CamelCase<S extends string> = S extends `${infer H}_${infer T}`
  ? `${Lowercase<H>}${Capitalize<CamelCase<T>>}`
  : S extends `${infer H}-${infer T}`
    ? `${Lowercase<H>}${Capitalize<CamelCase<T>>}`
    : Lowercase<S>;

export type CamelCasedProps<T> = {
  [K in keyof T as K extends string ? CamelCase<K> : K]: T[K];
};

/**
 * Configuration options for Intent.
 *
 * This is a camelCase version of the INTENT config object from config.ts.
 */
export type IntentConfig = {
  model?: string;
  timeoutMs?: number;
  relevancyThreshold?: number;
  batchSize?: number;
  tinyBatchFraction?: number;
};

/**
 * Complete options object for Intent constructor.
 *
 * Merges all configuration into a single, fully optional object:
 * - LLM client and runtime context (llm, logger, userId)
 * - Item extractors (key, summary)
 * - Intent configuration (model, timeoutMs, relevancyThreshold, batchSize, tinyBatchFraction)
 *
 * All fields are optional with sensible defaults:
 * - llm: Auto-detected from GROQ_API_KEY if available
 * - key: Hash-based string from JSON representation
 * - summary: Pretty-printed JSON of the item (2-space indentation for LLM readability)
 * - Config values: From environment variables or built-in defaults
 *
 * @template T - The type of items to rerank
 */
export type IntentOptions<T> = IntentContext & IntentExtractors<T> & IntentConfig;

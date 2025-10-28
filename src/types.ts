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

export type RerankerCandidate = {
  key: string;
  summary: string;
};

export type RerankerExtractors<T> = {
  key: (item: T) => string;
  summary?: (item: T) => string;
};

export type IntentContext = {
  llm?: LlmClient; // if omitted and GROQ_API_KEY present, a Groq client is used
  logger?: LoggerLike;
  userId?: string; // optional per-instance user id used for provider abuse monitoring
};

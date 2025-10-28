import "dotenv/config";
import { int, number, string } from "./lib/config";

/**
 * Exported config object (no function call required) following API patterns.
 */
export const CONFIG = {
  GROQ: {
    API_KEY: string("GROQ_API_KEY", { default: "" }),
    DEFAULT_MODEL: string("GROQ_DEFAULT_MODEL", { default: "openai/gpt-oss-20b" }),
    DEFAULT_TEMPERATURE: number("GROQ_DEFAULT_TEMPERATURE", { default: 0, min: 0, max: 1 }),
  },
  RERANKER: {
    MODEL: string("INTENT_MODEL", { default: "openai/gpt-oss-20b" }),
    TIMEOUT_MS: int("INTENT_TIMEOUT_MS", { default: 3000, min: 1 }),
    RELEVANCY_THRESHOLD: int("INTENT_RELEVANCY_THRESHOLD", { default: 0, min: 0, max: 10 }),
    BATCH_SIZE: int("INTENT_BATCH_SIZE", { default: 20, min: 1 }),
    TINY_BATCH_FRACTION: number("INTENT_TINY_BATCH_FRACTION", { default: 0.2, min: 0, max: 1 }),
  },
} as const;

import "dotenv/config";
import { enumString, int, number, string } from "./lib/config";

/**
 * Exported config object (no function call required) following API patterns.
 */
export const CONFIG = {
  GROQ: {
    API_KEY: string("GROQ_API_KEY", { default: "" }),
    DEFAULT_MODEL: string("GROQ_DEFAULT_MODEL", { default: "openai/gpt-oss-20b" }),
    DEFAULT_TEMPERATURE: number("GROQ_DEFAULT_TEMPERATURE", { default: 0, min: 0, max: 1 }),
    JSON_REPAIR_ATTEMPTS: int("GROQ_JSON_REPAIR_ATTEMPTS", { default: 3, min: 0 }),
  },
  INTENT: {
    PROVIDER: enumString("INTENT_PROVIDER", { default: "GROQ", values: ["GROQ"] as const }),
    TIMEOUT_MS: int("INTENT_TIMEOUT_MS", { default: 3000, min: 1 }),
    MIN_SCORE: int("INTENT_MIN_SCORE", { default: 0 }),
    MAX_SCORE: int("INTENT_MAX_SCORE", { default: 10, min: 1 }),
    RELEVANCY_THRESHOLD: int("INTENT_RELEVANCY_THRESHOLD", { default: 0 }),
    BATCH_SIZE: int("INTENT_BATCH_SIZE", { default: 20, min: 1 }),
    TINY_BATCH_FRACTION: number("INTENT_TINY_BATCH_FRACTION", { default: 0.2, min: 0, max: 1 }),
  },
  TEST: {
    SCOPE: string("TEST_SCOPE", { default: "all" }),
  },
} as const;

import "dotenv/config";
import { enumeration, int, number, string } from "./lib/config";

/**
 * Exported config object (no function call required) following API patterns.
 */
export const CONFIG = {
  CEREBRAS: {
    API_KEY: string("CEREBRAS_API_KEY", { default: "" }),
    DEFAULT_MODEL: string("CEREBRAS_DEFAULT_MODEL", { default: "qwen-3.8-27b" }),
    DEFAULT_REASONING_EFFORT: enumeration("CEREBRAS_DEFAULT_REASONING_EFFORT", {
      default: "none",
      values: ["none", "low", "medium", "high"] as const,
    }),
    JSON_REPAIR_ATTEMPTS: int("CEREBRAS_JSON_REPAIR_ATTEMPTS", { default: 3, min: 0 }),
  },
  INTENT: {
    PROVIDER: enumeration("INTENT_PROVIDER", {
      default: "CEREBRAS",
      values: ["CEREBRAS"] as const,
    }),
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

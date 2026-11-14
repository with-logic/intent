import { CONFIG } from "./config";
import { createDefaultCerebrasClient } from "./providers/cerebras";

import type { LlmClient, IntentContext } from "./types";

/**
 * Select an LLM client to use for reranking.
 *
 * Implements the client selection logic:
 * 1. If ctx.llm is provided, use it directly
 * 2. Else if CEREBRAS_API_KEY environment variable is set, create default Cerebras client
 * 3. Else return undefined (caller must handle error)
 *
 * @param ctx - Context object potentially containing an LLM client
 * @returns Selected LLM client, or undefined if none available
 */
export function selectLlmClient(
  ctx: IntentContext,
  config: typeof CONFIG = CONFIG,
): LlmClient | undefined {
  if (ctx.llm) {
    return ctx.llm;
  }
  const cerebrasKey = config.CEREBRAS.API_KEY;
  if (cerebrasKey && cerebrasKey !== "") {
    return createDefaultCerebrasClient(cerebrasKey, {
      defaults: {
        model: config.CEREBRAS.DEFAULT_MODEL,
        reasoningEffort: config.CEREBRAS.DEFAULT_REASONING_EFFORT,
      },
    });
  }
  return undefined;
}

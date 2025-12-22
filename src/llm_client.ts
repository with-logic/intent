import { CONFIG } from "./config";
import { createDefaultGroqClient } from "./providers/groq";

import type { LlmClient, IntentContext } from "./types";

/**
 * Select an LLM client to use for reranking.
 *
 * Implements the client selection logic:
 * 1. If ctx.llm is provided, use it directly
 * 2. Else if GROQ_API_KEY environment variable is set, create default Groq client
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
  const groqKey = config.GROQ.API_KEY;
  if (groqKey && groqKey !== "") {
    return createDefaultGroqClient(groqKey, {
      defaults: {
        model: config.GROQ.DEFAULT_MODEL,
        reasoningEffort: config.GROQ.DEFAULT_REASONING_EFFORT,
      },
    });
  }
  return undefined;
}

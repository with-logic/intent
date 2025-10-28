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
export function selectLlmClient(ctx: IntentContext): LlmClient | undefined {
  if (ctx.llm) {
    return ctx.llm;
  }
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey && groqKey !== "") {
    return createDefaultGroqClient(groqKey);
  }
  return undefined;
}

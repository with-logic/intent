import type { JSONObject } from "./types";

/**
 * Build a strict JSON schema mapping candidate keys to integer 0-10.
 *
 * Creates a JSON schema object with one required integer property per candidate key.
 * Sets additionalProperties to false to prevent the LLM from adding extra keys.
 * Used with LLM providers that support structured output (e.g., Groq's json_schema mode).
 *
 * @param keys - Array of unique candidate keys
 * @returns JSON schema object enforcing exact structure of response
 */
export function buildRelevancySchema(keys: string[]): JSONObject {
  const properties: Record<string, any> = {};
  for (const k of keys) properties[k] = { type: "integer" };
  return {
    title: "Query / Candidate Relevancy Assessment",
    description: "Map candidate results for a search query to relevancy scores (0-10).",
    type: "object",
    properties,
    required: keys,
    additionalProperties: false,
  } as JSONObject;
}

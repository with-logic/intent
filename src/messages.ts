import type { ChatMessage, RerankerCandidate } from "./types";

/**
 * Build system + user messages instructing the model to score candidates.
 *
 * Constructs a two-message conversation:
 * 1. System message: Defines the scoring task, output format, and constraints
 * 2. User message: Contains the query and candidate items as JSON
 *
 * The system prompt emphasizes using the full 0-10 range and being decisive
 * about relevance, with strict instructions to return only the score mapping.
 *
 * @param query - The search query or user intent
 * @param candidates - Array of candidates with keys and summaries
 * @returns Array of chat messages ready for LLM consumption
 */
export function buildMessages(query: string, candidates: RerankerCandidate[]): ChatMessage[] {
  const system = `The user will provide a short description of a query they are trying to automate, along with a JSON blob containing candidate_search_results. Each candidate result has a uniquely identifying key and a short summary. Your task is to assess each candidate and return a JSON object that maps candidate keys to integers from 0 to 10: 0 means not relevant at all, and 10 means highly relevant. Sometimes none are relevant, sometimes all are relevant. Be aggressive and decisive on relevancy.

It is okay to return 0 if the candidate is not relevant to the query. It is okay to return 10 if the candidate is highly relevant to the query. Use the full range of scores.

Every key in candidate_search_results must be present in your output mapping. Do not add any keys that are not present in candidate_search_results.
Every key in candidate_search_results must map to an integer from 0 to 10.
Do not, in your generated JSON, include anything other than the \`"{key}": {score}\` mappings. Do not include any other text, formatting, context, explanation, or punctuation. Only provide your score.

Return a JSON object that matches the enforced JSON schema for response formatting. Use the candidate.key as the property name in the output mapping.

The JSON you return should be of the form: {
    "Key for document 1": 0,
    "Key for document 2": 7,
    ...
}

Pretty-print the JSON for readability.`;

  const payload = {
    query,
    candidate_search_results: candidates.map((c) => ({ key: c.key, summary: c.summary })),
  } as const;

  return [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(payload) },
  ];
}

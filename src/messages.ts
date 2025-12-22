import { jsonStringify } from "./extractors";

import type { ChatMessage, IntentCandidate } from "./types";

/**
 * Build system + user messages instructing the model to score candidates.
 *
 * Constructs a two-message conversation:
 * 1. System message: Defines the scoring task, output format, and constraints
 * 2. User message: Contains the query and candidate items as JSON
 *
 * The system prompt emphasizes using the full configured score range and being decisive
 * about relevance, with strict instructions to return only the score mapping.
 *
 * @param query - The search query or user intent
 * @param candidates - Array of candidates with keys and summaries
 * @returns Array of chat messages ready for LLM consumption
 */
export function buildMessages(
  query: string,
  candidates: IntentCandidate[],
  scoreRange: { minScore: number; maxScore: number },
): ChatMessage[] {
  const system = `The user will provide a short description of a query they are trying to automate, along with a JSON blob containing candidate_search_results. Each candidate result has a uniquely identifying key and a short summary. Your task is to assess each candidate and return a JSON object that maps candidate keys to objects of the form {"explanation": string, "score": integer} where score is from ${scoreRange.minScore} to ${scoreRange.maxScore}: ${scoreRange.minScore} means not relevant at all, and ${scoreRange.maxScore} means highly relevant. Sometimes none are relevant, sometimes all are relevant. Be aggressive and decisive on relevancy.

It is okay to return ${scoreRange.minScore} if the candidate is not relevant to the query. It is okay to return ${scoreRange.maxScore} if the candidate is highly relevant to the query. Use the full range of scores.

Every candidate MUST include an explanation. Write the explanation first, then the score. The explanation should be concise (1-3 sentences), concrete, and reference the query intent and the candidate summary.

Every key in candidate_search_results must be present in your output mapping. Do not add any keys that are not present in candidate_search_results.
Every key in candidate_search_results must map to an object with:
- explanation: string
- score: integer from ${scoreRange.minScore} to ${scoreRange.maxScore}
Do not, in your generated JSON, include anything other than the \`"{key}": {"explanation": "...", "score": 7}\` mappings. Do not include any other text outside the JSON.

Return a JSON object that matches the enforced JSON schema for response formatting. Use the candidate.key as the property name in the output mapping.

The JSON you return should be of the form: {
    "Key for document 1": { "explanation": "...", "score": ${scoreRange.minScore} },
    "Key for document 2": { "explanation": "...", "score": ${scoreRange.maxScore} },
    ...
}

Pretty-print the JSON for readability.`;

  const payload = {
    query,
    candidate_search_results: candidates.map((c) => ({ key: c.key, summary: c.summary })),
  } as const;

  return [
    { role: "system", content: system },
    { role: "user", content: jsonStringify(payload) },
  ];
}

/**
 * Build system + user messages instructing the model to filter candidates.
 *
 * The model must output a JSON object mapping each candidate key to:
 * Example: {"Some key": {"explanation": "...", "isRelevant": true}}.
 *
 * @param query - The search query or user intent
 * @param candidates - Array of candidates with keys and summaries
 * @returns Array of chat messages ready for LLM consumption
 */
export function buildFilterMessages(query: string, candidates: IntentCandidate[]): ChatMessage[] {
  const system = `The user will provide a short description of a query they are trying to automate, along with a JSON blob containing candidate_search_results. Your task is to assess each candidate and return a JSON object that maps candidate keys to objects of the form {"explanation": string, "isRelevant": boolean}.

Return isRelevant=true only when the candidate clearly helps satisfy the query intent. Otherwise return isRelevant=false.

Every candidate MUST include an explanation. Write the explanation first, then the boolean. The explanation should be concise (1-3 sentences), concrete, and reference the query intent and the candidate summary.

Every key in candidate_search_results must be present in your output mapping. Do not add any keys that are not present in candidate_search_results.
Every key in candidate_search_results must map to an object with:
- explanation: string
- isRelevant: boolean
Do not include anything other than the mapping JSON object. Return only JSON matching the enforced schema.

Pretty-print the JSON for readability.`;

  const payload = {
    query,
    candidate_search_results: candidates.map((c) => ({ key: c.key, summary: c.summary })),
  } as const;

  return [
    { role: "system", content: system },
    { role: "user", content: jsonStringify(payload) },
  ];
}

/**
 * Build system + user messages instructing the model to choose exactly one candidate.
 *
 * The model must output a JSON object of the form:
 * Example: {"explanation": "...", "selectedKey": "Some key"}.
 *
 * @param query - The search query or user intent
 * @param candidates - Array of candidates with keys and summaries
 * @returns Array of chat messages ready for LLM consumption
 */
export function buildChoiceMessages(query: string, candidates: IntentCandidate[]): ChatMessage[] {
  const system = `The user will provide a short description of a query they are trying to automate, along with a JSON blob containing candidate_search_results. Your task is to choose exactly one candidate as the best match for the query.

You MUST choose one candidate key from the provided list. Do not choose multiple.

Return ONLY JSON of the form: {"explanation": string, "selectedKey": string} where selectedKey is exactly one of the candidate keys. The explanation should be concise (1-3 sentences), concrete, and reference the query intent and the candidate summary.

Do not include any other text outside the JSON. Return only JSON matching the enforced schema.

Pretty-print the JSON for readability.`;

  const payload = {
    query,
    candidate_search_results: candidates.map((c) => ({ key: c.key, summary: c.summary })),
  } as const;

  return [
    { role: "system", content: system },
    { role: "user", content: jsonStringify(payload) },
  ];
}

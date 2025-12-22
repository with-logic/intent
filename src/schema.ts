import type { JSONObject } from "./types";

type IntegerSchema = { type: "integer" };
type StringSchema = { type: "string" };

type CandidateEvaluationSchema = {
  type: "object";
  properties: {
    explanation: StringSchema;
    score: IntegerSchema;
  };
  required: ["explanation", "score"];
  additionalProperties: false;
};

/**
 * Build the schema used for a single candidate's evaluation.
 *
 * Property order is intentional: `explanation` is defined before `score` to
 * encourage structured-output models to generate explanations first.
 *
 * @returns JSON schema for a single candidate evaluation
 */
export function buildCandidateEvaluationSchema(): CandidateEvaluationSchema {
  return {
    type: "object",
    properties: {
      explanation: { type: "string" },
      score: { type: "integer" },
    },
    required: ["explanation", "score"],
    additionalProperties: false,
  };
}

/**
 * Build a strict JSON schema mapping candidate keys to evaluation objects.
 *
 * Each candidate key maps to an object containing:
 * - explanation: a short justification of the score
 * - score: an integer 0-10
 *
 * Property order is intentional (`explanation` then `score`) to encourage the
 * model to generate explanations before scores in structured-output modes.
 *
 * @param keys - Array of unique candidate keys
 * @returns JSON schema object enforcing exact structure of response
 */
export function buildRelevancySchema(keys: string[]): JSONObject {
  const evaluationSchema = buildCandidateEvaluationSchema();

  const properties: Record<string, CandidateEvaluationSchema> = {};
  for (const k of keys) {
    properties[k] = evaluationSchema;
  }

  return {
    title: "Query / Candidate Relevancy Assessment",
    description:
      "Map candidate results for a search query to relevancy scores (0-10) with explanations.",
    type: "object",
    properties,
    required: keys,
    additionalProperties: false,
  } as JSONObject;
}

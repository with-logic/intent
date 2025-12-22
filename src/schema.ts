import type { JSONObject } from "./types";

type IntegerSchema = { type: "integer" };
type StringSchema = { type: "string" };
type BooleanSchema = { type: "boolean" };

type CandidateEvaluationSchema = {
  type: "object";
  properties: {
    explanation: StringSchema;
    score: IntegerSchema;
  };
  required: ["explanation", "score"];
  additionalProperties: false;
};

type CandidateFilterSchema = {
  type: "object";
  properties: {
    explanation: StringSchema;
    isRelevant: BooleanSchema;
  };
  required: ["explanation", "isRelevant"];
  additionalProperties: false;
};

type ChoiceSchema = {
  type: "object";
  properties: {
    explanation: StringSchema;
    selectedKey: { type: "string"; enum: string[] };
  };
  required: ["explanation", "selectedKey"];
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
 * Build the schema used for a single candidate's filter decision.
 *
 * Property order is intentional: `explanation` is defined before `isRelevant`.
 *
 * @returns JSON schema for a single candidate filter decision
 */
export function buildCandidateFilterSchema(): CandidateFilterSchema {
  return {
    type: "object",
    properties: {
      explanation: { type: "string" },
      isRelevant: { type: "boolean" },
    },
    required: ["explanation", "isRelevant"],
    additionalProperties: false,
  };
}

/**
 * Build a strict JSON schema mapping candidate keys to evaluation objects.
 *
 * Each candidate key maps to an object containing:
 * - explanation: a short justification of the score
 * - score: an integer within the configured range
 *
 * Property order is intentional (`explanation` then `score`) to encourage the
 * model to generate explanations before scores in structured-output modes.
 *
 * @param keys - Array of unique candidate keys
 * @returns JSON schema object enforcing exact structure of response
 */
export function buildRelevancySchema(
  keys: string[],
  minScore: number,
  maxScore: number,
): JSONObject {
  const evaluationSchema = buildCandidateEvaluationSchema();

  const properties: Record<string, CandidateEvaluationSchema> = {};
  for (const k of keys) {
    properties[k] = evaluationSchema;
  }

  return {
    title: "Query / Candidate Relevancy Assessment",
    description: `Map candidate results for a search query to relevancy scores (${minScore}-${maxScore}) with explanations.`,
    type: "object",
    properties,
    required: keys,
    additionalProperties: false,
  } as JSONObject;
}

/**
 * Build a strict JSON schema mapping candidate keys to boolean relevancy decisions.
 *
 * Each candidate key maps to an object containing:
 * - explanation: a short justification
 * - isRelevant: boolean
 *
 * @param keys - Array of unique candidate keys
 * @returns JSON schema object enforcing exact structure of response
 */
export function buildFilterSchema(keys: string[]): JSONObject {
  const decisionSchema = buildCandidateFilterSchema();

  const properties: Record<string, CandidateFilterSchema> = {};
  for (const k of keys) {
    properties[k] = decisionSchema;
  }

  return {
    title: "Query / Candidate Relevancy Filter",
    description:
      "Map candidate results for a search query to boolean relevancy decisions with explanations.",
    type: "object",
    properties,
    required: keys,
    additionalProperties: false,
  } as JSONObject;
}

/**
 * Build a strict JSON schema for choosing a single candidate key.
 *
 * The model must return:
 * - explanation: string
 * - selectedKey: one of the provided candidate keys (enum)
 *
 * @param keys - Array of unique candidate keys
 * @returns JSON schema enforcing a single selected key
 */
export function buildChoiceSchema(keys: string[]): JSONObject {
  return {
    title: "Query / Candidate Single Choice",
    description: "Choose exactly one candidate key for the query and explain why.",
    type: "object",
    properties: {
      explanation: { type: "string" },
      selectedKey: { type: "string", enum: keys },
    },
    required: ["explanation", "selectedKey"],
    additionalProperties: false,
  } as ChoiceSchema as JSONObject;
}

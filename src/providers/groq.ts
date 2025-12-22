import Groq from "groq-sdk";

import { CONFIG } from "../config";

import type { ChatMessage, JSONObject, LlmCallConfig, LlmClient } from "../types";
import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";

type GroqTimeoutOptions = { timeout?: number };

type GroqJsonSchemaResponseFormat = {
  type: "json_schema";
  json_schema: {
    name: string;
    schema: JSONObject;
    strict: true;
  };
};

type GroqChatCompletionRequest = {
  model: string;
  reasoning_effort: "low" | "medium" | "high";
  messages: ChatCompletionMessageParam[];
  user?: string;
  response_format: GroqJsonSchemaResponseFormat;
};

type GroqChatCompletionResponse = {
  choices: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

/**
 * Return a best-effort nested error record from groq-sdk.
 *
 * @param err - Any thrown value
 * @returns Nested `error` object when present
 * @private
 */
function getNestedErrorObject(err: unknown): Record<string, unknown> | undefined {
  if (err == null || typeof err !== "object") {
    return undefined;
  }

  const record = err as Record<string, unknown>;
  const error = record.error;
  if (error == null || typeof error !== "object") {
    return undefined;
  }

  return error as Record<string, unknown>;
}

/**
 * Map internal ChatMessage to groq-sdk ChatCompletionMessageParam.
 *
 * Converts our generic message format to Groq's expected format.
 * Only supports system, user, and assistant roles. Throws on unsupported
 * roles (like "tool") to ensure predictable provider behavior.
 *
 * @param messages - Array of generic chat messages
 * @returns Array of Groq-formatted messages
 * @throws {Error} If message contains unsupported role
 * @private
 */
function mapToGroqMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (m.role === "system" || m.role === "user" || m.role === "assistant") {
      return { role: m.role, content: m.content } as ChatCompletionMessageParam;
    }
    throw new Error(`intent: '${m.role}' role messages are not supported in provider calls`);
  });
}

/**
 * Build the request payload expected by groq-sdk with strict JSON schema.
 *
 * Constructs the complete request object including model, reasoning effort, messages,
 * optional user ID, and the response_format configuration that enforces strict
 * JSON schema validation on the model's output.
 *
 * @param outputSchema - JSON schema defining expected response structure
 * @param groqMessages - Formatted chat messages
 * @param config - Optional config overriding model and reasoning effort
 * @param userId - Optional user identifier for Groq's abuse monitoring
 * @returns Request payload ready for groq-sdk
 * @private
 */
function buildGroqRequest(
  outputSchema: JSONObject,
  groqMessages: ChatCompletionMessageParam[],
  config: LlmCallConfig | undefined,
  userId: string | undefined,
  defaults: { model: string; reasoningEffort: "low" | "medium" | "high" },
): GroqChatCompletionRequest {
  return {
    model: config?.model ?? defaults.model,
    reasoning_effort: config?.reasoningEffort ?? defaults.reasoningEffort,
    messages: groqMessages,
    ...(userId ? { user: userId } : {}),
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "intent_relevancy",
        schema: outputSchema,
        strict: true,
      },
    },
  };
}

/**
 * Execute the chat completion with an optional timeout.
 *
 * Wraps the Groq SDK's chat.completions.create call with optional timeout support.
 *
 * @param client - Initialized Groq SDK client
 * @param request - Complete request payload
 * @param timeoutMs - Optional timeout in milliseconds
 * @returns Raw completion response from Groq
 * @private
 */
async function executeCompletion(
  client: GroqSdkLike,
  request: GroqChatCompletionRequest,
  timeoutMs?: number,
): Promise<GroqChatCompletionResponse> {
  const timeout: GroqTimeoutOptions | undefined =
    typeof timeoutMs === "number" ? { timeout: timeoutMs } : undefined;
  return client.chat.completions.create(request, timeout);
}

/**
 * Extract and validate the content string from a Groq response.
 *
 * Safely navigates the response structure to find the message content.
 * Throws if content is missing or not a string.
 *
 * @param response - Raw completion response from Groq SDK
 * @returns The message content as a string
 * @throws {Error} If content is missing or invalid
 * @private
 */
function getResponseContent(response: GroqChatCompletionResponse): string {
  const content: string | null | undefined = response?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Groq did not return content");
  }
  return content;
}

/**
 * Parse the model's JSON content, throwing a clear error on failure.
 *
 * Attempts to parse the string content as JSON and wraps it in a { data } object
 * to match the expected LlmClient return type.
 *
 * @param content - JSON string from model response
 * @returns Wrapped parsed data
 * @throws {Error} If content is not valid JSON
 * @private
 */
function parseJson<T>(content: string): { data: T } {
  try {
    const data = JSON.parse(content);
    return { data } as { data: T };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const err = new Error(`Groq returned invalid JSON: ${detail}`);
    (err as Error & { rawOutput?: string }).rawOutput = content;
    throw err;
  }
}

type JsonRepairInput = {
  rawOutput: string;
  errorMessage: string;
};

type RetryState = {
  remaining: number;
  request: GroqChatCompletionRequest;
};

/**
 * Build a repair conversation turn to help the model correct invalid JSON.
 *
 * We include the raw output and the error message, then remind the model to
 * return only valid JSON that matches the already-provided schema.
 *
 * @param baseMessages - Original Groq-formatted messages
 * @param rawOutput - Raw model output that failed parsing
 * @param errorMessage - Parse/validation error message
 * @returns New messages array including a repair request
 * @private
 */
function buildJsonRepairMessages(
  baseMessages: ChatCompletionMessageParam[],
  rawOutput: string,
  errorMessage: string,
): ChatCompletionMessageParam[] {
  return [
    ...baseMessages,
    { role: "assistant", content: rawOutput } as ChatCompletionMessageParam,
    {
      role: "user",
      content:
        "Your previous response was invalid JSON or did not match the required JSON schema. " +
        "Please correct it and return ONLY valid JSON that matches the schema.\n\n" +
        `Error: ${errorMessage}`,
    } as ChatCompletionMessageParam,
  ];
}

/**
 * Build a repair request object if we still have attempts remaining.
 *
 * @param remaining - Attempts remaining for the overall call
 * @param request - The current Groq request
 * @param repair - Repair context
 * @returns The repaired request and decremented remaining attempts, or undefined
 * @private
 */
function buildRepairRetry(state: RetryState, repair: JsonRepairInput): RetryState | undefined {
  if (state.remaining <= 1) {
    return undefined;
  }

  const repairedRequest: GroqChatCompletionRequest = {
    ...state.request,
    messages: buildJsonRepairMessages(
      state.request.messages,
      repair.rawOutput,
      repair.errorMessage,
    ),
  };

  return { remaining: state.remaining - 1, request: repairedRequest };
}

/**
 * Convert a JSON parse error into a repair input.
 *
 * @param rawOutput - Raw model output
 * @param parseError - JSON.parse error
 * @returns Repair input
 * @private
 */
function parseErrorToRepairInput(rawOutput: string, parseError: unknown): JsonRepairInput {
  return { rawOutput, errorMessage: String(parseError) };
}

/**
 * Extract raw output from a JSON parse error thrown by parseJson.
 *
 * @param error - Error thrown by parseJson
 * @returns Raw output when present
 * @private
 */
function getRawOutputFromParseJsonError(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const record = error as Error & { rawOutput?: unknown };
  return typeof record.rawOutput === "string" ? record.rawOutput : undefined;
}

/**
 * Extract repair inputs from a Groq schema-validation failure.
 *
 * Groq can return a rich error payload for `json_validate_failed`, sometimes
 * including the model's `generated_response`. We use this to ask the model to
 * correct its output without re-sending the schema.
 *
 * @param err - Unknown thrown error from groq-sdk
 * @returns Repair inputs when present; otherwise undefined
 * @private
 */
function extractJsonValidateFailedRepairInput(err: unknown): JsonRepairInput | undefined {
  if (err instanceof Error) {
    const match = err.message.match(/"failed_generation":"(\{.*?\})"/);
    const failedGeneration = match?.[1] ? match[1].replace(/\\"/g, '"') : undefined;
    if (err.message.includes('"code":"json_validate_failed"')) {
      return {
        rawOutput:
          failedGeneration ?? "(Groq did not include the rejected generation in the error payload)",
        errorMessage: err.message,
      };
    }
  }

  const errorObj = getNestedErrorObject(err);
  const nested =
    errorObj && typeof errorObj.error === "object"
      ? (errorObj.error as Record<string, unknown>)
      : undefined;
  const serverError = nested ?? errorObj;
  if (!serverError) {
    return undefined;
  }

  const code = typeof serverError.code === "string" ? serverError.code : undefined;
  if (code !== "json_validate_failed") {
    return undefined;
  }

  const message = typeof serverError.message === "string" ? serverError.message : undefined;
  const generatedResponse =
    typeof serverError.generated_response === "string" ? serverError.generated_response : undefined;
  const failedGeneration =
    typeof serverError.failed_generation === "string" ? serverError.failed_generation : undefined;
  const rawOutput = generatedResponse ?? failedGeneration;

  return {
    rawOutput: rawOutput ?? "(Groq did not include the rejected generation in the error payload)",
    errorMessage: message ?? String(err),
  };
}

/**
 * Create a default Groq LLM client with retry logic.
 *
 * Returns an LlmClient implementation that uses the Groq SDK with:
 * - Strict JSON schema enforcement via response_format
 * - Automatic retry on schema validation failures (up to 3 attempts)
 * - Support for custom model, reasoning effort, timeout, and user ID
 *
 * @param apiKey - Groq API key
 * @returns LlmClient implementation for Groq
 *
 * @example
 * ```typescript
 * import { CONFIG } from "../config";
 * const client = createDefaultGroqClient(CONFIG.GROQ.API_KEY);
 * const result = await client.call(messages, schema, { model: "llama-3.3-70b" });
 * ```
 */
export type GroqSdkLike = {
  chat: {
    completions: {
      create: (
        req: GroqChatCompletionRequest,
        opts?: GroqTimeoutOptions,
      ) => Promise<GroqChatCompletionResponse>;
    };
  };
};

type GroqClientFactory = (apiKey: string) => GroqSdkLike;

/**
 * Create a GroqSdkLike wrapper around groq-sdk.
 *
 * This keeps our provider surface strongly typed while isolating groq-sdk's
 * broader request/response types to a single boundary.
 *
 * @param apiKey - Groq API key
 * @returns GroqSdkLike wrapper
 * @private
 */
export function createGroqSdkLike(apiKey: string): GroqSdkLike {
  const sdk = new Groq({ apiKey }) as any;
  return {
    chat: {
      completions: {
        create: async (req, opts) => {
          // groq-sdk's types lag behind json_schema support; keep the boundary localized.
          return (await (sdk.chat.completions.create as any)(
            req,
            opts,
          )) as GroqChatCompletionResponse;
        },
      },
    },
  };
}

/**
 * Create the underlying Groq SDK client.
 *
 * This wrapper exists to make the default SDK construction path unit-testable.
 *
 * @param options - Groq SDK constructor options
 * @returns Groq SDK client
 * @private
 */
export function createGroqSdk(options: { apiKey: string }): unknown {
  return new Groq(options);
}

export function createDefaultGroqClient(
  apiKey: string,
  options?: {
    defaults?: { model?: string; reasoningEffort?: "low" | "medium" | "high" };
    makeSdk?: (apiKey: string) => GroqSdkLike;
    jsonRepairAttempts?: number;
  },
): LlmClient {
  const defaults = {
    model: options?.defaults?.model ?? CONFIG.GROQ.DEFAULT_MODEL,
    reasoningEffort: options?.defaults?.reasoningEffort ?? CONFIG.GROQ.DEFAULT_REASONING_EFFORT,
  } as const;
  const makeSdk: GroqClientFactory = options?.makeSdk ?? createGroqSdkLike;
  const jsonRepairAttempts = options?.jsonRepairAttempts ?? CONFIG.GROQ.JSON_REPAIR_ATTEMPTS;
  return {
    /**
     * Call Groq with JSON schema enforced response and return parsed data.
     *
     * Implements the LlmClient interface with Groq-specific features:
     * - Creates a new SDK client per call with the provided API key
     * - Maps generic messages to Groq format
     * - Builds request with strict JSON schema response format
     * - Retries up to 3 times on json_validate_failed errors
     * - Parses and returns the structured response
     *
     * @param messages - Chat messages to send to the model
     * @param outputSchema - JSON schema defining expected response structure
     * @param config - Optional model, reasoning effort, and timeout overrides
     * @param userId - Optional user ID for Groq's abuse monitoring
     * @returns Parsed response data wrapped in { data } object
     * @throws {Error} If all retry attempts fail or response is invalid
     */
    async call<T>(
      messages: ChatMessage[],
      outputSchema: JSONObject,
      config?: LlmCallConfig,
      userId?: string,
    ): Promise<{ data: T }> {
      const client = makeSdk(apiKey);
      const groqMessages = mapToGroqMessages(messages);
      const baseRequest = buildGroqRequest(outputSchema, groqMessages, config, userId, defaults);

      const createWithRetry = async (state: RetryState): Promise<{ data: T }> => {
        try {
          const response = await executeCompletion(client, state.request, config?.timeoutMs);
          const content = getResponseContent(response);

          const parsed = parseJson<T>(content);
          return parsed;
        } catch (err) {
          // If the model returned bad JSON, retry by appending a repair turn.
          const parseRawOutput = getRawOutputFromParseJsonError(err);
          if (parseRawOutput !== undefined) {
            const retry = buildRepairRetry(state, parseErrorToRepairInput(parseRawOutput, err));
            if (retry) {
              return createWithRetry(retry);
            }
            throw err;
          }

          const validationRepairInput = extractJsonValidateFailedRepairInput(err);
          if (validationRepairInput) {
            const retry = buildRepairRetry(state, validationRepairInput);
            if (retry) {
              return createWithRetry(retry);
            }
          }

          // Non-JSON errors are terminal (quota/outage/etc.).
          throw err;
        }
      };

      const attempts = Math.max(1, jsonRepairAttempts);
      return createWithRetry({ remaining: attempts, request: baseRequest });
    },
  } satisfies LlmClient;
}

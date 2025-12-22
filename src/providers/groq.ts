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
  temperature: number;
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

type GroqApiErrorLike = {
  code?: string;
  error?: {
    code?: string | undefined;
  };
};

/**
 * Narrow an unknown error to the Groq-shaped error payloads we care about.
 *
 * @param err - Any thrown value
 * @returns Best-effort Groq error shape for retry decisions
 * @private
 */
function asGroqApiErrorLike(err: unknown): GroqApiErrorLike {
  if (err == null || typeof err !== "object") {
    return {};
  }
  const record = err as Record<string, unknown>;
  const error = record.error;
  const errorObj =
    error != null && typeof error === "object" ? (error as Record<string, unknown>) : undefined;

  const code = typeof record.code === "string" ? record.code : undefined;
  const nestedCode = errorObj && typeof errorObj.code === "string" ? errorObj.code : undefined;

  return {
    ...(code !== undefined && { code }),
    ...(nestedCode !== undefined && { error: { code: nestedCode } }),
  };
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
 * Constructs the complete request object including model, temperature, messages,
 * optional user ID, and the response_format configuration that enforces strict
 * JSON schema validation on the model's output.
 *
 * @param outputSchema - JSON schema defining expected response structure
 * @param groqMessages - Formatted chat messages
 * @param config - Optional config overriding model/temperature
 * @param userId - Optional user identifier for Groq's abuse monitoring
 * @returns Request payload ready for groq-sdk
 * @private
 */
function buildGroqRequest(
  outputSchema: JSONObject,
  groqMessages: ChatCompletionMessageParam[],
  config: LlmCallConfig | undefined,
  userId: string | undefined,
  defaults: { model: string; temperature: number },
): GroqChatCompletionRequest {
  return {
    model: config?.model ?? defaults.model,
    temperature: config?.temperature ?? defaults.temperature,
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
  } catch {
    throw new Error("Groq returned invalid JSON");
  }
}

/**
 * Determine whether an error warrants a retry based on schema validation.
 *
 * Groq can occasionally return responses that fail JSON schema validation.
 * This function checks for that specific error code and whether retries remain.
 *
 * @param err - Error object from failed completion
 * @param remaining - Number of retry attempts remaining
 * @returns True if error is retriable and retries remain
 * @private
 */
function shouldRetry(err: GroqApiErrorLike, remaining: number): boolean {
  const code = err.code ?? err.error?.code;
  return code === "json_validate_failed" && remaining > 1;
}

/**
 * Create a default Groq LLM client with retry logic.
 *
 * Returns an LlmClient implementation that uses the Groq SDK with:
 * - Strict JSON schema enforcement via response_format
 * - Automatic retry on schema validation failures (up to 3 attempts)
 * - Support for custom model, temperature, timeout, and user ID
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
    defaults?: { model?: string; temperature?: number };
    makeSdk?: (apiKey: string) => GroqSdkLike;
  },
): LlmClient {
  const defaults = {
    model: options?.defaults?.model ?? CONFIG.GROQ.DEFAULT_MODEL,
    temperature: options?.defaults?.temperature ?? CONFIG.GROQ.DEFAULT_TEMPERATURE,
  } as const;
  const makeSdk: GroqClientFactory = options?.makeSdk ?? createGroqSdkLike;
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
     * @param config - Optional model, temperature, and timeout overrides
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
      const request = buildGroqRequest(outputSchema, groqMessages, config, userId, defaults);

      const createWithRetry = async (remaining: number): Promise<{ data: T }> => {
        try {
          const response = await executeCompletion(client, request, config?.timeoutMs);
          const content = getResponseContent(response);
          return parseJson<T>(content);
        } catch (err) {
          if (shouldRetry(asGroqApiErrorLike(err), remaining)) {
            return createWithRetry(remaining - 1);
          }
          throw err;
        }
      };

      return createWithRetry(3);
    },
  } satisfies LlmClient;
}

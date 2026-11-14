import Cerebras from "@cerebras/cerebras_cloud_sdk";

import { CONFIG } from "../config";

import type { ChatMessage, JSONObject, LlmCallConfig, LlmClient } from "../types";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "@cerebras/cerebras_cloud_sdk/resources/chat/completions";

/** Sampling temperature for every call. Ranking must be as repeatable as the model allows. */
const TEMPERATURE = 0;

type CerebrasReasoningEffort = NonNullable<LlmCallConfig["reasoningEffort"]>;

type CerebrasMessage = ChatCompletionCreateParamsNonStreaming["messages"][number];

/**
 * The part of the Cerebras SDK that this provider uses.
 *
 * Tests inject a fake with this shape; production code passes the real SDK client.
 */
export type CerebrasSdkLike = {
  chat: {
    completions: {
      create: (
        request: ChatCompletionCreateParamsNonStreaming,
        options?: { timeout?: number },
      ) => PromiseLike<ChatCompletion>;
    };
  };
};

type CerebrasClientOptions = {
  defaults?: { model?: string; reasoningEffort?: CerebrasReasoningEffort };
  sdk?: CerebrasSdkLike;
  /** Total calls allowed per request, including the first. 0 and 1 both mean no repair. */
  jsonRepairAttempts?: number;
};

type RepairState = {
  remaining: number;
  request: ChatCompletionCreateParamsNonStreaming;
};

/**
 * Create the Cerebras SDK client.
 *
 * The SDK warms a TCP connection in its constructor by default. We turn that
 * off so that creating an Intent instance never starts network traffic.
 *
 * @param apiKey - Cerebras API key
 * @returns Cerebras SDK client
 * @private
 */
function createCerebrasSdk(apiKey: string): CerebrasSdkLike {
  return new Cerebras({ apiKey, warmTCPConnection: false });
}

/**
 * Map internal ChatMessage values to Cerebras chat messages.
 *
 * Only system, user and assistant roles are supported. A "tool" role throws, so
 * that provider behavior stays predictable.
 *
 * @param messages - Generic chat messages
 * @returns Cerebras-formatted messages
 * @throws {Error} If a message has an unsupported role
 * @private
 */
function mapToCerebrasMessages(messages: ChatMessage[]): CerebrasMessage[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      throw new Error(
        `intent: '${message.role}' role messages are not supported in provider calls`,
      );
    }
    return { role: message.role, content: message.content };
  });
}

/**
 * Build the chat completion request with a strict JSON schema response format.
 *
 * @param messages - Cerebras-formatted messages
 * @param outputSchema - JSON schema for the expected response
 * @param config - Optional per-call model and reasoning effort overrides
 * @param userId - Optional user identifier
 * @param defaults - Model and reasoning effort used when `config` has none
 * @returns Request ready for the SDK
 * @private
 */
function buildRequest(
  messages: CerebrasMessage[],
  outputSchema: JSONObject,
  config: LlmCallConfig | undefined,
  userId: string | undefined,
  defaults: { model: string; reasoningEffort: CerebrasReasoningEffort },
): ChatCompletionCreateParamsNonStreaming {
  return {
    model: config?.model ?? defaults.model,
    reasoning_effort: config?.reasoningEffort ?? defaults.reasoningEffort,
    temperature: TEMPERATURE,
    messages,
    ...(userId ? { user: userId } : {}),
    response_format: {
      type: "json_schema",
      json_schema: { name: "intent_relevancy", schema: outputSchema, strict: true },
    },
  };
}

/**
 * Read the message content from a completion response.
 *
 * @param response - Response from the SDK
 * @returns The message content
 * @throws {Error} If the response is not a chat completion or has no text content
 * @private
 */
function getResponseContent(response: ChatCompletion): string {
  // The SDK return type is a union that also holds chunk and error shapes.
  // Only a full completion carries message content.
  const isCompletion = "object" in response && response.object === "chat.completion";
  const content = isCompletion ? response.choices[0]?.message?.content : undefined;
  if (typeof content === "string") {
    return content;
  }
  if ("error" in response) {
    // Status and error code/type only. The error message can echo request content.
    const { code, type } = response.error;
    throw new Error(
      `Cerebras returned an error response (status_code=${response.status_code}, ` +
        `code=${code ?? "n/a"}, type=${type ?? "n/a"})`,
    );
  }
  const finishReason = isCompletion ? (response.choices[0]?.finish_reason ?? "unknown") : "n/a";
  const object = "object" in response ? String(response.object) : "missing";
  throw new Error(
    `Cerebras did not return content (object=${object}, finish_reason=${finishReason})`,
  );
}

/**
 * Build the request for a repair attempt after the model returned invalid JSON.
 *
 * Strict mode makes invalid JSON rare. It still happens when the model stops
 * early (for example at the token limit), so we show the model its own output.
 *
 * @param request - The request that produced invalid JSON
 * @param rawOutput - The invalid output
 * @param errorMessage - The JSON parse error message
 * @returns A new request with a repair turn appended
 * @private
 */
function buildRepairRequest(
  request: ChatCompletionCreateParamsNonStreaming,
  rawOutput: string,
  errorMessage: string,
): ChatCompletionCreateParamsNonStreaming {
  return {
    ...request,
    messages: [
      ...request.messages,
      { role: "assistant", content: rawOutput },
      {
        role: "user",
        content:
          "Your previous response was not valid JSON. " +
          "Please correct it and return ONLY valid JSON that matches the schema.\n\n" +
          `Error: ${errorMessage}`,
      },
    ],
  };
}

/**
 * Send one request to the SDK and hide the response body of an API error.
 *
 * An API error message is built from the response body, which can echo the request content.
 * The original error stays available as `cause`.
 *
 * @param sdk - SDK client
 * @param request - Request to send
 * @param options - Optional per-request SDK options
 * @returns The SDK response
 * @throws {Error} A content-free error for an API error, or the original error otherwise
 * @private
 */
async function createCompletion(
  sdk: CerebrasSdkLike,
  request: Parameters<CerebrasSdkLike["chat"]["completions"]["create"]>[0],
  options: { timeout: number } | undefined,
) {
  try {
    return await sdk.chat.completions.create(request, options);
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    if (typeof status === "number") {
      throw Object.assign(new Error(`Cerebras request failed (status=${status})`), {
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * Send the request, parse the JSON content, and retry with a repair turn on a parse failure.
 *
 * Errors from the SDK (rate limits, invalid requests, timeouts, outages) are not
 * retried here. The SDK already retries 408, 429 and 5xx responses.
 *
 * @param sdk - SDK client
 * @param state - Request and number of attempts left
 * @param timeoutMs - Optional per-request timeout in milliseconds
 * @returns Parsed data wrapped in `{ data }`
 * @throws {Error} If the SDK fails, or the content is still invalid JSON after the last attempt
 * @private
 */
async function completeWithRepair<T>(
  sdk: CerebrasSdkLike,
  state: RepairState,
  timeoutMs: number | undefined,
): Promise<{ data: T }> {
  const options = typeof timeoutMs === "number" ? { timeout: timeoutMs } : undefined;
  const content = getResponseContent(await createCompletion(sdk, state.request, options));
  try {
    return { data: JSON.parse(content) as T };
  } catch (error) {
    const detail = String(error);
    if (state.remaining <= 1) {
      // The parse error text can quote the completion, so it stays out of the message.
      throw Object.assign(new Error("Cerebras returned invalid JSON after all attempts"), {
        cause: error,
      });
    }
    const request = buildRepairRequest(state.request, content, detail);
    return completeWithRepair<T>(sdk, { remaining: state.remaining - 1, request }, timeoutMs);
  }
}

/**
 * Create the default Cerebras LLM client.
 *
 * The client:
 * - Enforces a strict JSON schema through `response_format`
 * - Uses temperature 0
 * - Repairs invalid JSON by asking the model again (up to `jsonRepairAttempts` calls in total)
 *
 * @param apiKey - Cerebras API key
 * @param options - Optional defaults, SDK override (for tests) and repair attempt limit
 * @returns LlmClient implementation for Cerebras
 *
 * @example
 * ```typescript
 * const client = createDefaultCerebrasClient(process.env.CEREBRAS_API_KEY ?? "");
 * const result = await client.call(messages, schema, {
 *   model: "gpt-oss-120b",
 *   reasoningEffort: "low",
 * });
 * ```
 */
export function createDefaultCerebrasClient(
  apiKey: string,
  options?: CerebrasClientOptions,
): LlmClient {
  const defaults = {
    model: options?.defaults?.model ?? CONFIG.CEREBRAS.DEFAULT_MODEL,
    reasoningEffort: options?.defaults?.reasoningEffort ?? CONFIG.CEREBRAS.DEFAULT_REASONING_EFFORT,
  };
  const sdk = options?.sdk ?? createCerebrasSdk(apiKey);
  const requestedAttempts = options?.jsonRepairAttempts ?? CONFIG.CEREBRAS.JSON_REPAIR_ATTEMPTS;
  // NaN and Infinity would never end the repair loop, so they fall back to the configured default.
  const attempts = Number.isFinite(requestedAttempts)
    ? Math.max(1, Math.floor(requestedAttempts))
    : Math.max(1, CONFIG.CEREBRAS.JSON_REPAIR_ATTEMPTS);

  return {
    /**
     * Call Cerebras with a strict JSON schema and return the parsed response.
     *
     * @param messages - Chat messages to send
     * @param outputSchema - JSON schema for the expected response
     * @param config - Optional model, reasoning effort and timeout overrides
     * @param userId - Optional user identifier
     * @returns Parsed response data wrapped in `{ data }`
     * @throws {Error} If the request fails or the response is not valid JSON
     */
    async call<T>(
      messages: ChatMessage[],
      outputSchema: JSONObject,
      config?: LlmCallConfig,
      userId?: string,
    ): Promise<{ data: T }> {
      const cerebrasMessages = mapToCerebrasMessages(messages);
      const request = buildRequest(cerebrasMessages, outputSchema, config, userId, defaults);
      return completeWithRepair<T>(sdk, { remaining: attempts, request }, config?.timeoutMs);
    },
  } satisfies LlmClient;
}

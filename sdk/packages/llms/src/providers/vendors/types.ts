import type {
	GatewayProviderContext,
	GatewayStreamRequest,
	GeneratedMedia,
	ModelTool,
	ModelToolName,
} from "@cline/shared";
import type { CallSettings, ToolSet } from "ai";
import type { RetryEmptyResponseOptions } from "../middleware/retry-empty-response";

export type ProviderGeneratedMedia = Omit<GeneratedMedia, "id" | "sizeBytes">;

export interface ModelToolResultProjection {
	media: readonly ProviderGeneratedMedia[];
	activityOutput?: unknown;
}

export interface BuiltModelTool {
	tool: ToolSet[string];
	/** Project a provider-native tool result into canonical assistant media. */
	projectResult?: (output: unknown) => ModelToolResultProjection;
}

export type BuiltModelTools = Partial<Record<ModelToolName, BuiltModelTool>>;

export interface ProviderFactoryResult {
	operations: {
		language: (modelId: string) => unknown;
		imageGeneration?: (modelId: string) => unknown;
		speechGeneration?: (modelId: string) => unknown;
		videoGeneration?: (modelId: string) => unknown;
		transcription?: (modelId: string) => unknown;
	};
	/** Translate portable model-tool intent into provider-defined AI SDK tools. */
	buildModelTools?: (tools: readonly ModelTool[]) => BuiltModelTools;
	/** AI SDK executes provider-defined client tools and continues model steps. */
	executesModelTools?: boolean;
	/**
	 * Policy for the gateway-level transient-failure retry. Every vendor
	 * model is wrapped with `createRetryEmptyResponseMiddleware` at the
	 * central composition point in `ai-sdk.ts`, which retries two transient
	 * failure modes within one attempt budget: an all-empty turn (no text,
	 * no reasoning, no tool call — otherwise hard-fails the task with
	 * "Model returned empty response") and a mid-stream network
	 * interruption before any model output (socket closed, body/headers
	 * timeout, ECONNRESET — otherwise kills the run; the AI SDK's own retry
	 * covers only request initiation). Set `false` to opt a vendor out, or
	 * provide options to tune attempts/delays without forking the
	 * middleware. Leave unset for the defaults.
	 */
	retryEmptyResponses?: false | Omit<RetryEmptyResponseOptions, "logger">;
	buildStreamConfig?: (
		request: GatewayStreamRequest,
		context: GatewayProviderContext,
	) => Partial<CallSettings>;
}

export interface AiSdkStreamPart {
	type?: string;
	[key: string]: unknown;
}

/**
 * AI SDK's normalized usage structure emitted in the finish stream part.
 * This is the intermediate representation available before stream completion.
 * All token counts use camelCase naming convention.
 *
 * @property inputTokens - Total input/prompt tokens (all providers)
 * @property inputTokenDetails - Breakdown of input tokens:
 *   - noCacheTokens: Fresh (non-cached) input tokens (Anthropic, OpenRouter, Gemini)
 *   - cacheReadTokens: Tokens read from cache (Anthropic, OpenRouter)
 *   - cacheWriteTokens: Tokens written to cache (Anthropic, OpenRouter)
 * @property outputTokens - Total output/completion tokens (all providers)
 * @property outputTokenDetails - Breakdown of output tokens:
 *   - textTokens: Regular text tokens (OpenAI, OpenRouter, Gemini)
 *   - reasoningTokens: Tokens used for reasoning (OpenAI with o1, OpenRouter, Anthropic with extended thinking)
 * @property totalTokens - Sum of input and output tokens (all providers)
 * @property reasoningTokens - Total reasoning tokens (OpenAI, OpenRouter)
 * @property cachedInputTokens - Alias for cache-read tokens (convenience field)
 */
export interface AiSdkStreamTotalUsage {
	inputTokens?: number;
	inputTokenDetails?: {
		noCacheTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
	};
	outputTokens?: number;
	outputTokenDetails?: {
		textTokens?: number;
		reasoningTokens?: number;
	};
	totalTokens?: number;
	reasoningTokens?: number;
	cachedInputTokens?: number;
}

/**
 * AI SDK's complete usage structure available via stream.usage promise after completion.
 * Extends AiSdkStreamTotalUsage and adds the raw provider-specific response.
 * The raw field contains unmodified provider responses, enabling cost extraction and detailed billing info.
 *
 * @property raw - Provider-specific raw response fields:
 *   **Anthropic**: input_tokens, cache_creation_input_tokens, cache_read_input_tokens,
 *     cache_creation.ephemeral_5m_input_tokens, cache_creation.ephemeral_1h_input_tokens,
 *     output_tokens, service_tier, inference_geo
 *   **Gemini**: promptTokenCount, candidatesTokenCount, totalTokenCount, promptTokensDetails
 *   **OpenAI/Vercel**: input_tokens, input_tokens_details.cached_tokens, output_tokens,
 *     output_tokens_details.reasoning_tokens
 *   **OpenRouter**: prompt_tokens, completion_tokens, total_tokens, prompt_tokens_details.cached_tokens,
 *     completion_tokens_details.reasoning_tokens, cost, is_byok, cost_details, market_cost
 */
export interface AiSdkStreamUsage extends AiSdkStreamTotalUsage {
	raw?: {
		input_tokens?: number;
		cache_creation_input_tokens?: number;
		cache_read_input_tokens?: number;
		cache_creation?: {
			ephemeral_5m_input_tokens?: number;
			ephemeral_1h_input_tokens?: number;
		};
		input_tokens_details?: {
			cached_tokens?: number;
			cache_write_tokens?: number;
		};
		output_tokens?: number;
		output_tokens_details?: {
			reasoning_tokens?: number;
		};
		service_tier?: string;
		inference_geo?: string;
		promptTokenCount?: number;
		candidatesTokenCount?: number;
		totalTokenCount?: number;
		promptTokensDetails?: {
			cached_tokens?: number;
			cache_write_tokens?: number;
		};
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
		prompt_tokens_details?: {
			cached_tokens?: number;
			cache_write_tokens?: number;
		};
		completion_tokens_details?: {
			reasoning_tokens?: number;
		};
		cost?: number;
		is_byok?: boolean;
		cost_details?: {
			upstream_inference_cost?: number | null;
			upstream_inference_prompt_cost?: number;
			upstream_inference_completions_cost?: number;
		};
		market_cost?: number;
	};
	reasoningTokens?: number;
	cachedInputTokens?: number;
}

/**
 * Finish event part emitted when streaming completes.
 * Contains early usage data (without raw provider response) and finish metadata.
 *
 * @property type - Always "finish"
 * @property finishReason - Normalized finish reason (stop, max_tokens, tool-calls, error)
 * @property rawFinishReason - Provider's original finish reason string
 * @property totalUsage - Usage snapshot at end of stream (AiSdkStreamTotalUsage structure)
 */
export interface AiSdkStreamFinishPart {
	type: "finish";
	finishReason?: string;
	rawFinishReason?: string;
	totalUsage?: AiSdkStreamTotalUsage | Record<string, unknown>;
}

/**
 * Complete result from AI SDK's streamText() call.
 * Provides both streaming content (text, tool-calls, reasoning) and usage data via promises.
 *
 * @property fullStream - Raw stream parts (text-delta, tool-call, finish, etc.)
 * @property textStream - Convenience iterator for just text deltas
 * @property text - Promise that resolves to complete generated text
 * @property usage - Promise that resolves to complete usage data with raw provider response.
 *   This is preferred over the finish part's totalUsage because it includes cost_details
 *   and other provider-specific metadata needed for accurate billing.
 */
export interface AiSdkStreamResult {
	fullStream?: AsyncIterable<AiSdkStreamPart>;
	textStream?: AsyncIterable<string>;
	text?: Promise<string> | string;
	usage?: Promise<AiSdkStreamUsage | Record<string, unknown>>;
}

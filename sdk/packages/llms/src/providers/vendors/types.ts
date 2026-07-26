import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@bedrock-coder/shared";
import type { CallSettings } from "ai";

export interface ProviderFactoryResult {
	model: (modelId: string) => unknown;
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
 * @property inputTokens - Total input/prompt tokens
 * @property inputTokenDetails - Breakdown of input tokens:
 *   - noCacheTokens: Fresh (non-cached) input tokens
 *   - cacheReadTokens: Tokens read from cache
 *   - cacheWriteTokens: Tokens written to cache
 * @property outputTokens - Total output/completion tokens
 * @property outputTokenDetails - Breakdown of output tokens:
 *   - textTokens: Regular text tokens
 *   - reasoningTokens: Tokens used for extended thinking
 * @property totalTokens - Sum of input and output tokens
 * @property reasoningTokens - Total reasoning tokens
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
 * @property raw - Raw Bedrock model usage fields.
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

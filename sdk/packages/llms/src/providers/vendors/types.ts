export interface ProviderFactoryResult {
	model: (modelId: string) => unknown;
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
		};
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
		prompt_tokens_details?: {
			cached_tokens?: number;
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

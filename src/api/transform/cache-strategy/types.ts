import { Anthropic } from "@anthropic-ai/sdk"
import { SystemContentBlock, Message } from "@aws-sdk/client-bedrock-runtime"

/**
 * Information about a model's capabilities and constraints
 */
export interface ModelInfo {
	/** Maximum number of tokens the model can generate */
	maxTokens: number
	/** Maximum context window size in tokens */
	contextWindow: number
	/** Whether the model supports prompt caching */
	supportsPromptCache: boolean
	/** Maximum number of cache points supported by the model */
	maxCachePoints: number
	/** Minimum number of tokens required for a cache point */
	minTokensPerCachePoint: number
	/** Fields that can be cached */
	cachableFields: Array<"system" | "messages" | "tools">
}

/**
 * Cache point definition
 */
export interface CachePoint {
	/** Type of cache point */
	type: "default"
}

/**
 * Result of cache strategy application
 */
export interface CacheResult {
	/** System content blocks */
	system: SystemContentBlock[]
	/** Message content blocks */
	messages: Message[]
	/** Cache point placements for messages (for maintaining consistency across consecutive messages) */
	messageCachePointPlacements?: CachePointPlacement[]
}

/**
 * Represents the position and metadata for a cache point
 */
export interface CachePointPlacement {
	/** Where to insert the cache point */
	index: number
	/** Type of cache point */
	type: "system" | "message"
	/** Number of tokens this cache point covers */
	tokensCovered: number
}

/**
 * Configuration for the caching strategy
 */
export interface CacheStrategyConfig {
	/** Model information */
	modelInfo: ModelInfo
	/** System prompt text */
	systemPrompt?: string
	/** Messages to process */
	messages: Anthropic.Messages.MessageParam[]
	/** Whether to use prompt caching */
	usePromptCache: boolean
	/** Previous cache point placements (for maintaining consistency across consecutive messages) */
	previousCachePointPlacements?: CachePointPlacement[]
}

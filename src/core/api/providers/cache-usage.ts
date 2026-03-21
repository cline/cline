export interface OpenAiCompatibleCacheUsage {
	prompt_tokens_details?: {
		cached_tokens?: number
		cache_write_tokens?: number
	}
	cache_creation_input_tokens?: number
	cache_read_input_tokens?: number
	prompt_cache_miss_tokens?: number
	prompt_cache_hit_tokens?: number
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined
}

export function extractCacheTokenUsage(usage?: OpenAiCompatibleCacheUsage): {
	cacheReadTokens: number
	cacheWriteTokens: number
} {
	if (!usage) {
		return {
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		}
	}

	const cacheReadTokens =
		asNumber(usage.prompt_tokens_details?.cached_tokens) ??
		asNumber(usage.cache_read_input_tokens) ??
		asNumber(usage.prompt_cache_hit_tokens) ??
		0
	const cacheWriteTokens =
		asNumber(usage.prompt_tokens_details?.cache_write_tokens) ??
		asNumber(usage.cache_creation_input_tokens) ??
		asNumber(usage.prompt_cache_miss_tokens) ??
		0

	return {
		cacheReadTokens,
		cacheWriteTokens,
	}
}

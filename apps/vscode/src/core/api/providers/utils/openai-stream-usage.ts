import { ApiStreamUsageChunk } from "../../transform/stream"

export interface OpenAiStreamUsage {
	prompt_tokens?: number | null
	completion_tokens?: number | null
	prompt_tokens_details?: {
		cached_tokens?: number | null
	} | null
	prompt_cache_miss_tokens?: number | null
}

export class OpenAiStreamUsageTracker {
	private lastUsage: OpenAiStreamUsage | undefined

	record(usage: OpenAiStreamUsage | null | undefined): void {
		if (usage) {
			this.lastUsage = usage
		}
	}

	getUsageChunk(): ApiStreamUsageChunk | undefined {
		if (!this.lastUsage) {
			return undefined
		}

		return {
			type: "usage",
			inputTokens: this.lastUsage.prompt_tokens || 0,
			outputTokens: this.lastUsage.completion_tokens || 0,
			cacheReadTokens: this.lastUsage.prompt_tokens_details?.cached_tokens || 0,
			cacheWriteTokens: this.lastUsage.prompt_cache_miss_tokens || 0,
		}
	}
}

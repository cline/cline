import type { ModelInfo } from "../model.js"

// https://docs.litellm.ai/
export const litellmDefaultModelId = "claude-3-7-sonnet-20250219"

export const litellmDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,
	supportsComputerUse: true,
	supportsPromptCache: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
}

export const LITELLM_COMPUTER_USE_MODELS = new Set([
	"claude-3-5-sonnet-latest",
	"claude-opus-4-20250514",
	"claude-sonnet-4-20250514",
	"claude-3-7-sonnet-latest",
	"claude-3-7-sonnet-20250219",
	"claude-3-5-sonnet-20241022",
	"vertex_ai/claude-3-5-sonnet",
	"vertex_ai/claude-3-5-sonnet-v2",
	"vertex_ai/claude-3-5-sonnet-v2@20241022",
	"vertex_ai/claude-3-7-sonnet@20250219",
	"vertex_ai/claude-opus-4@20250514",
	"vertex_ai/claude-sonnet-4@20250514",
	"openrouter/anthropic/claude-3.5-sonnet",
	"openrouter/anthropic/claude-3.5-sonnet:beta",
	"openrouter/anthropic/claude-3.7-sonnet",
	"openrouter/anthropic/claude-3.7-sonnet:beta",
	"anthropic.claude-opus-4-20250514-v1:0",
	"anthropic.claude-sonnet-4-20250514-v1:0",
	"anthropic.claude-3-7-sonnet-20250219-v1:0",
	"anthropic.claude-3-5-sonnet-20241022-v2:0",
	"us.anthropic.claude-3-5-sonnet-20241022-v2:0",
	"us.anthropic.claude-3-7-sonnet-20250219-v1:0",
	"us.anthropic.claude-opus-4-20250514-v1:0",
	"us.anthropic.claude-sonnet-4-20250514-v1:0",
	"eu.anthropic.claude-3-5-sonnet-20241022-v2:0",
	"eu.anthropic.claude-3-7-sonnet-20250219-v1:0",
	"eu.anthropic.claude-opus-4-20250514-v1:0",
	"eu.anthropic.claude-sonnet-4-20250514-v1:0",
	"snowflake/claude-3-5-sonnet",
])

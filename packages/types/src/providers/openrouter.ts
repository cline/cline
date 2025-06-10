import type { ModelInfo } from "../model.js"

// https://openrouter.ai/models?order=newest&supported_parameters=tools
export const openRouterDefaultModelId = "anthropic/claude-sonnet-4"

export const openRouterDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,
	supportsComputerUse: true,
	supportsPromptCache: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
	description:
		"Claude 3.7 Sonnet is an advanced large language model with improved reasoning, coding, and problem-solving capabilities. It introduces a hybrid reasoning approach, allowing users to choose between rapid responses and extended, step-by-step processing for complex tasks. The model demonstrates notable improvements in coding, particularly in front-end development and full-stack updates, and excels in agentic workflows, where it can autonomously navigate multi-step processes. Claude 3.7 Sonnet maintains performance parity with its predecessor in standard mode while offering an extended reasoning mode for enhanced accuracy in math, coding, and instruction-following tasks. Read more at the [blog post here](https://www.anthropic.com/news/claude-3-7-sonnet)",
}

export const OPENROUTER_DEFAULT_PROVIDER_NAME = "[default]"

export const OPEN_ROUTER_PROMPT_CACHING_MODELS = new Set([
	"anthropic/claude-3-haiku",
	"anthropic/claude-3-haiku:beta",
	"anthropic/claude-3-opus",
	"anthropic/claude-3-opus:beta",
	"anthropic/claude-3-sonnet",
	"anthropic/claude-3-sonnet:beta",
	"anthropic/claude-3.5-haiku",
	"anthropic/claude-3.5-haiku-20241022",
	"anthropic/claude-3.5-haiku-20241022:beta",
	"anthropic/claude-3.5-haiku:beta",
	"anthropic/claude-3.5-sonnet",
	"anthropic/claude-3.5-sonnet-20240620",
	"anthropic/claude-3.5-sonnet-20240620:beta",
	"anthropic/claude-3.5-sonnet:beta",
	"anthropic/claude-3.7-sonnet",
	"anthropic/claude-3.7-sonnet:beta",
	"anthropic/claude-3.7-sonnet:thinking",
	"anthropic/claude-sonnet-4",
	"anthropic/claude-opus-4",
	"google/gemini-2.5-flash-preview",
	"google/gemini-2.5-flash-preview:thinking",
	"google/gemini-2.5-flash-preview-05-20",
	"google/gemini-2.5-flash-preview-05-20:thinking",
	"google/gemini-2.0-flash-001",
	"google/gemini-flash-1.5",
	"google/gemini-flash-1.5-8b",
])

// https://www.anthropic.com/news/3-5-models-and-computer-use
export const OPEN_ROUTER_COMPUTER_USE_MODELS = new Set([
	"anthropic/claude-3.5-sonnet",
	"anthropic/claude-3.5-sonnet:beta",
	"anthropic/claude-3.7-sonnet",
	"anthropic/claude-3.7-sonnet:beta",
	"anthropic/claude-3.7-sonnet:thinking",
	"anthropic/claude-sonnet-4",
	"anthropic/claude-opus-4",
])

// When we first launched these models we didn't have support for
// enabling/disabling the reasoning budget for hybrid models. Now that we
// do support this we should give users the option to enable/disable it
// whenever possible. However these particular (virtual) model ids with the
// `:thinking` suffix always require the reasoning budget to be enabled, so
// for backwards compatibility we should still require it.
// We should *not* be adding new models to this set.
export const OPEN_ROUTER_REQUIRED_REASONING_BUDGET_MODELS = new Set([
	"anthropic/claude-3.7-sonnet:thinking",
	"google/gemini-2.5-flash-preview-05-20:thinking",
])

export const OPEN_ROUTER_REASONING_BUDGET_MODELS = new Set([
	"anthropic/claude-3.7-sonnet:beta",
	"anthropic/claude-opus-4",
	"anthropic/claude-sonnet-4",
	"google/gemini-2.5-pro-preview",
	"google/gemini-2.5-flash-preview-05-20",
	// Also include the models that require the reasoning budget to be enabled
	// even though `OPEN_ROUTER_REQUIRED_REASONING_BUDGET_MODELS` takes precedence.
	"anthropic/claude-3.7-sonnet:thinking",
	"google/gemini-2.5-flash-preview-05-20:thinking",
])

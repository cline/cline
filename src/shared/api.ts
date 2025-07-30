import {
	type ModelInfo,
	type ProviderSettings,
	type ProviderName,
	ANTHROPIC_DEFAULT_MAX_TOKENS,
	CLAUDE_CODE_DEFAULT_MAX_OUTPUT_TOKENS,
} from "@roo-code/types"

// Provider Format Mapping

/**
 * Maps API provider names to their corresponding format for model parameter handling.
 * This centralizes the provider-to-format mapping logic used across the codebase.
 *
 * @param apiProvider - The API provider name
 * @returns The format string used by getModelParams and getModelMaxOutputTokens, or undefined if not mapped
 */
export function getFormatForProvider(
	apiProvider: ProviderName | undefined,
): "anthropic" | "openai" | "gemini" | "openrouter" | undefined {
	if (!apiProvider) {
		return undefined
	}

	switch (apiProvider) {
		// Anthropic-based providers
		case "anthropic":
		case "bedrock":
		case "vertex": // Note: vertex can use either anthropic or gemini format depending on the model
		case "claude-code":
		case "requesty": // Uses anthropic format based on code analysis
			return "anthropic"

		// OpenAI-based providers
		case "openai":
		case "openai-native":
		case "deepseek":
		case "moonshot":
		case "xai":
		case "groq":
		case "chutes":
		case "mistral":
		case "ollama":
		case "lmstudio":
		case "litellm":
		case "huggingface":
		case "glama":
		case "unbound":
		case "vscode-lm":
		case "human-relay":
		case "fake-ai":
			return "openai"

		// Gemini-based providers
		case "gemini":
		case "gemini-cli":
			return "gemini"

		// OpenRouter
		case "openrouter":
			return "openrouter"

		// Providers that don't have a specific format mapping
		default:
			return undefined
	}
}

/**
 * Special case: Vertex provider can use either anthropic or gemini format depending on the model.
 * This function checks if a vertex model should use anthropic format.
 *
 * @param modelId - The model ID to check
 * @returns true if the model should use anthropic format
 */
export function isVertexAnthropicModel(modelId?: string): boolean {
	return modelId?.toLowerCase().includes("claude") ?? false
}

// ApiHandlerOptions

export type ApiHandlerOptions = Omit<ProviderSettings, "apiProvider">

// RouterName

const routerNames = ["openrouter", "requesty", "glama", "unbound", "litellm", "ollama", "lmstudio"] as const

export type RouterName = (typeof routerNames)[number]

export const isRouterName = (value: string): value is RouterName => routerNames.includes(value as RouterName)

export function toRouterName(value?: string): RouterName {
	if (value && isRouterName(value)) {
		return value
	}

	throw new Error(`Invalid router name: ${value}`)
}

// RouterModels

export type ModelRecord = Record<string, ModelInfo>

export type RouterModels = Record<RouterName, ModelRecord>

// Reasoning

export const shouldUseReasoningBudget = ({
	model,
	settings,
}: {
	model: ModelInfo
	settings?: ProviderSettings
}): boolean => !!model.requiredReasoningBudget || (!!model.supportsReasoningBudget && !!settings?.enableReasoningEffort)

export const shouldUseReasoningEffort = ({
	model,
	settings,
}: {
	model: ModelInfo
	settings?: ProviderSettings
}): boolean => (!!model.supportsReasoningEffort && !!settings?.reasoningEffort) || !!model.reasoningEffort

export const DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS = 16_384
export const DEFAULT_HYBRID_REASONING_MODEL_THINKING_TOKENS = 8_192

// Max Tokens

export const getModelMaxOutputTokens = ({
	modelId,
	model,
	settings,
	format,
}: {
	modelId: string
	model: ModelInfo
	settings?: ProviderSettings
	format?: "anthropic" | "openai" | "gemini" | "openrouter"
}): number | undefined => {
	// Check for Claude Code specific max output tokens setting
	if (settings?.apiProvider === "claude-code") {
		return settings.claudeCodeMaxOutputTokens || CLAUDE_CODE_DEFAULT_MAX_OUTPUT_TOKENS
	}

	// If format is not provided, derive it from the provider settings
	const effectiveFormat = format ?? getFormatForProvider(settings?.apiProvider)

	if (shouldUseReasoningBudget({ model, settings })) {
		return settings?.modelMaxTokens || DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS
	}

	const isAnthropicContext =
		modelId.includes("claude") ||
		effectiveFormat === "anthropic" ||
		(effectiveFormat === "openrouter" && modelId.startsWith("anthropic/"))

	// For "Hybrid" reasoning models, discard the model's actual maxTokens for Anthropic contexts
	if (model.supportsReasoningBudget && isAnthropicContext) {
		return ANTHROPIC_DEFAULT_MAX_TOKENS
	}

	// For Anthropic contexts, always ensure a maxTokens value is set
	if (isAnthropicContext && (!model.maxTokens || model.maxTokens === 0)) {
		return ANTHROPIC_DEFAULT_MAX_TOKENS
	}

	// If model has explicit maxTokens and it's not the full context window, use it
	if (model.maxTokens && model.maxTokens !== model.contextWindow) {
		return model.maxTokens
	}

	// For non-Anthropic formats without explicit maxTokens, return undefined
	if (effectiveFormat) {
		return undefined
	}

	// Default fallback
	return ANTHROPIC_DEFAULT_MAX_TOKENS
}

// GetModelsOptions

export type GetModelsOptions =
	| { provider: "openrouter" }
	| { provider: "glama" }
	| { provider: "requesty"; apiKey?: string }
	| { provider: "unbound"; apiKey?: string }
	| { provider: "litellm"; apiKey: string; baseUrl: string }
	| { provider: "ollama"; baseUrl?: string }
	| { provider: "lmstudio"; baseUrl?: string }

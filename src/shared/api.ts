import { type ModelInfo, type ProviderSettings, ANTHROPIC_DEFAULT_MAX_TOKENS } from "@roo-code/types"

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
}: {
	modelId: string
	model: ModelInfo
	settings?: ProviderSettings
}): number | undefined => {
	if (shouldUseReasoningBudget({ model, settings })) {
		return settings?.modelMaxTokens || DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS
	}

	const isAnthropicModel = modelId.includes("claude")

	// For "Hybrid" reasoning models, we should discard the model's actual
	// `maxTokens` value if we're not using reasoning. We do this for Anthropic
	// models only for now. Should we do this for Gemini too?
	if (model.supportsReasoningBudget && isAnthropicModel) {
		return ANTHROPIC_DEFAULT_MAX_TOKENS
	}

	return model.maxTokens ?? undefined
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

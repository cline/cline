import { ApiHandlerModel, ApiProviderInfo } from "@core/api"
import { AnthropicModelId, anthropicModels } from "@/shared/api"

const CLAUDE_VERSION_MATCH_REGEX = /[-_ ]([\d](?:\.[05])?)[-_ ]?/

export function isNextGenModelProvider(providerInfo: ApiProviderInfo): boolean {
	const providerId = normalize(providerInfo.providerId)
	return [
		"cline",
		"anthropic",
		"gemini",
		"vertex",
		"openrouter",
		"openai",
		"minimax",
		"openai-native",
		"baseten",
		"vercel-ai-gateway",
	].some((id) => providerId === id)
}

export function modelDoesntSupportWebp(apiHandlerModel: ApiHandlerModel): boolean {
	const modelId = apiHandlerModel.id.toLowerCase()
	return modelId.includes("grok")
}

/**
 * Determines if reasoning content should be skipped for a given model
 * Currently skips reasoning for:
 * - Grok-4 models since they only display "thinking" without useful information
 * - Devstral models since they don't support reasoning_details field
 */
export function shouldSkipReasoningForModel(modelId?: string): boolean {
	if (!modelId) {
		return false
	}
	return modelId.includes("grok-4") || modelId.includes("devstral") || modelId.includes("glm")
}

export function isAnthropicModelId(modelId: string): modelId is AnthropicModelId {
	const CLAUDE_MODELS = ["sonnet", "opus", "haiku"]
	return modelId in anthropicModels || CLAUDE_MODELS.some((substring) => modelId.includes(substring))
}

export function isClaude4PlusModelFamily(id: string): boolean {
	const modelId = normalize(id)
	// Claude Code short aliases are always Claude 4+
	// These are used by ClaudeCodeHandler.getModel() when user selects "sonnet" or "opus"
	// Check before isAnthropicModelId to avoid type guard narrowing issues
	if (modelId === "sonnet" || modelId === "opus") {
		return true
	}
	if (!isAnthropicModelId(modelId)) {
		return false
	}
	// Get model version number
	const versionMatch = modelId.match(CLAUDE_VERSION_MATCH_REGEX)
	if (!versionMatch) {
		return false
	}
	const version = parseFloat(versionMatch[1])
	// Check if version is 4.0 or higher
	return version >= 4
}

export function isGemini2dot5ModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return modelId.includes("gemini-2.5")
}

export function isGrok4ModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return modelId.includes("grok-4")
}

export function isGPT5ModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return modelId.includes("gpt-5") || modelId.includes("gpt5")
}

export function isGPT51Model(id: string): boolean {
	const modelId = normalize(id)
	return modelId.includes("gpt-5.1") || modelId.includes("gpt-5-1")
}

export function isGPT52Model(id: string): boolean {
	const modelId = normalize(id)
	return modelId.includes("gpt-5.2") || modelId.includes("gpt-5-2")
}

export function isGLMModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return (
		modelId.includes("glm-4.6") ||
		modelId.includes("glm-4.5") ||
		modelId.includes("z-ai/glm") ||
		modelId.includes("zai-org/glm")
	)
}

export function isMinimaxModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return modelId.includes("minimax")
}

export function isHermesModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return (
		modelId.includes("hermes-4") ||
		modelId.includes("hermes4") ||
		modelId.includes("nous/hermes-4") ||
		modelId.includes("nous/hermes4") ||
		modelId.includes("nous-hermes-4") ||
		modelId.includes("nous/hermes4") ||
		modelId.includes("nousresearch/hermes-4") ||
		modelId.includes("nousresearch/hermes4")
	)
}

export function isNextGenOpenSourceModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return ["kimi-k2"].some((substring) => modelId.includes(substring))
}

export function isDevstralModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return modelId.includes("devstral")
}

export function isGemini3ModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return modelId.includes("gemini3") || modelId.includes("gemini-3")
}

function isDeepSeek32ModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return modelId.includes("deepseek") && modelId.includes("3.2") && !modelId.includes("speciale")
}

export function isNextGenModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return (
		isClaude4PlusModelFamily(modelId) ||
		isGemini2dot5ModelFamily(modelId) ||
		isGrok4ModelFamily(modelId) ||
		isGPT5ModelFamily(modelId) ||
		isMinimaxModelFamily(modelId) ||
		isGemini3ModelFamily(modelId) ||
		isNextGenOpenSourceModelFamily(modelId) ||
		isDeepSeek32ModelFamily(modelId)
	)
}

export function isLocalModel(providerInfo: ApiProviderInfo): boolean {
	const localProviders = ["lmstudio", "ollama"]
	return localProviders.includes(normalize(providerInfo.providerId))
}

/**
 * Parses a price string and converts it from per-token to per-million-tokens
 * @param priceString The price string to parse (e.g. from API responses)
 * @returns The price multiplied by 1,000,000 for per-million-token pricing, or 0 if invalid
 */
export function parsePrice(priceString: string | undefined): number {
	if (!priceString || priceString === "" || priceString === "0") {
		return 0
	}
	const parsed = parseFloat(priceString)
	if (Number.isNaN(parsed)) {
		return 0
	}
	// Convert from per-token to per-million-tokens (multiply by 1,000,000)
	return parsed * 1_000_000
}

/**
 * Determines if the given provider and model combination will use native tool calling.
 * Helpful if we need to quickly check this for prompts or other logic.
 * @param providerInfo The provider and model information
 * @param enableNativeToolCalls Whether the native tool calls setting is enabled
 * @returns true if the model will use native tool calling, false otherwise
 */
export function isNativeToolCallingConfig(providerInfo: ApiProviderInfo, enableNativeToolCalls: boolean): boolean {
	if (!enableNativeToolCalls) {
		return false
	}
	if (!isNextGenModelProvider(providerInfo)) {
		return false
	}
	const modelId = providerInfo.model.id.toLowerCase()
	return isNextGenModelFamily(modelId)
}

function normalize(text: string): string {
	return text.trim().toLowerCase()
}

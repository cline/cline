/**
 * Model ID utilities for chat command
 *
 * Functions to map providers to their corresponding model ID configuration keys.
 */

import type { ApiConfiguration, ApiProvider } from "@shared/api"
import type { Mode } from "@shared/storage/types"

/**
 * Get the model ID for the current provider and mode
 */
export function getModelIdForProvider(
	apiConfiguration: ApiConfiguration | undefined,
	provider: ApiProvider | undefined,
	mode: Mode,
): string | undefined {
	if (!apiConfiguration || !provider) {
		return undefined
	}

	const prefix = mode === "plan" ? "planMode" : "actMode"

	// Map provider to the corresponding model ID field
	switch (provider) {
		case "openrouter":
		case "cline":
			return apiConfiguration[`${prefix}OpenRouterModelId`]
		case "anthropic":
		case "claude-code":
		case "bedrock":
		case "vertex":
		case "gemini":
		case "openai-native":
		case "deepseek":
		case "qwen":
		case "qwen-code":
		case "doubao":
		case "mistral":
		case "asksage":
		case "xai":
		case "moonshot":
		case "nebius":
		case "sambanova":
		case "cerebras":
		case "sapaicore":
		case "zai":
		case "fireworks":
		case "minimax":
			return apiConfiguration[`${prefix}ApiModelId`]
		case "openai":
			return apiConfiguration[`${prefix}OpenAiModelId`]
		case "ollama":
			return apiConfiguration[`${prefix}OllamaModelId`]
		case "lmstudio":
			return apiConfiguration[`${prefix}LmStudioModelId`]
		case "requesty":
			return apiConfiguration[`${prefix}RequestyModelId`]
		case "together":
			return apiConfiguration[`${prefix}TogetherModelId`]
		case "litellm":
			return apiConfiguration[`${prefix}LiteLlmModelId`]
		case "groq":
			return apiConfiguration[`${prefix}GroqModelId`]
		case "baseten":
			return apiConfiguration[`${prefix}BasetenModelId`]
		case "huggingface":
			return apiConfiguration[`${prefix}HuggingFaceModelId`]
		case "huawei-cloud-maas":
			return apiConfiguration[`${prefix}HuaweiCloudMaasModelId`]
		case "oca":
			return apiConfiguration[`${prefix}OcaModelId`]
		case "hicap":
			return apiConfiguration[`${prefix}HicapModelId`]
		case "aihubmix":
			return apiConfiguration[`${prefix}AihubmixModelId`]
		case "nousResearch":
			return apiConfiguration[`${prefix}NousResearchModelId`]
		case "vercel-ai-gateway":
			return apiConfiguration[`${prefix}VercelAiGatewayModelId`]
		case "vscode-lm":
		case "dify":
		default:
			return undefined
	}
}

/**
 * Get the model ID state key for a given provider and mode
 * Some providers use provider-specific model ID keys (e.g., openRouterModelId),
 * while others use the generic apiModelId
 */
export function getModelIdKey(provider: string | undefined, mode: Mode): string {
	const modePrefix = mode === "plan" ? "planMode" : "actMode"

	switch (provider) {
		case "openrouter":
		case "cline":
			return `${modePrefix}OpenRouterModelId`
		case "openai":
			return `${modePrefix}OpenAiModelId`
		case "ollama":
			return `${modePrefix}OllamaModelId`
		case "lmstudio":
			return `${modePrefix}LmStudioModelId`
		case "litellm":
			return `${modePrefix}LiteLlmModelId`
		case "requesty":
			return `${modePrefix}RequestyModelId`
		case "together":
			return `${modePrefix}TogetherModelId`
		case "fireworks":
			return `${modePrefix}FireworksModelId`
		case "groq":
			return `${modePrefix}GroqModelId`
		case "baseten":
			return `${modePrefix}BasetenModelId`
		case "huggingface":
			return `${modePrefix}HuggingFaceModelId`
		case "huawei-cloud-maas":
			return `${modePrefix}HuaweiCloudMaasModelId`
		case "oca":
			return `${modePrefix}OcaModelId`
		case "hicap":
			return `${modePrefix}HicapModelId`
		case "aihubmix":
			return `${modePrefix}AihubmixModelId`
		case "nousResearch":
			return `${modePrefix}NousResearchModelId`
		case "vercel-ai-gateway":
			return `${modePrefix}VercelAiGatewayModelId`
		default:
			return `${modePrefix}ApiModelId`
	}
}

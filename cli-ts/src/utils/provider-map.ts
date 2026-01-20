import { ApiProvider } from "@/shared/api"

/**
 * Get the provider-specific model ID key for a given provider and mode.
 * Different providers store their model IDs in different state keys.
 */
export function getProviderModelIdKey(
	provider: ApiProvider,
	mode: "act" | "plan",
): keyof import("@shared/storage/state-keys").Settings | null {
	const prefix = mode === "act" ? "actMode" : "planMode"

	// Map providers to their specific model ID keys
	// Note: "cline" provider uses the same model ID key as "openrouter"
	const providerKeyMap: Partial<Record<ApiProvider, string>> = {
		openrouter: "OpenRouterModelId",
		cline: "OpenRouterModelId", // Cline provider uses OpenRouter model IDs
		openai: "OpenAiModelId",
		ollama: "OllamaModelId",
		lmstudio: "LmStudioModelId",
		litellm: "LiteLlmModelId",
		requesty: "RequestyModelId",
		together: "TogetherModelId",
		fireworks: "FireworksModelId",
		sapaicore: "SapAiCoreModelId",
		groq: "GroqModelId",
		baseten: "BasetenModelId",
		huggingface: "HuggingFaceModelId",
		"huawei-cloud-maas": "HuaweiCloudMaasModelId",
		oca: "OcaModelId",
		aihubmix: "AihubmixModelId",
		hicap: "HicapModelId",
		nousResearch: "NousResearchModelId",
		"vercel-ai-gateway": "VercelAiGatewayModelId",
	}

	const keySuffix = providerKeyMap[provider]
	if (keySuffix) {
		return `${prefix}${keySuffix}` as keyof import("@shared/storage/state-keys").Settings
	}

	// For providers without a specific key (anthropic, gemini, bedrock, etc.),
	// they use the generic actModeApiModelId/planModeApiModelId
	return null
}

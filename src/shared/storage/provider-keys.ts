// Map providers to their specific model ID keys

import { ApiProvider } from "../api"

// Note: "cline" provider uses the same model ID key as "openrouter"
const ProviderKeyMap: Partial<Record<ApiProvider, string>> = {
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
} as const

export const ProviderToApiKeyMap: Partial<Record<ApiProvider, string | string[]>> = {
	anthropic: "apiKey",
	openrouter: "openRouterApiKey",
	bedrock: ["awsAccessKey", "awsBedrockApiKey"],
	openai: "openAiApiKey",
	gemini: "geminiApiKey",
	"openai-native": "openAiNativeApiKey",
	ollama: "ollamaApiKey",
	requesty: "requestyApiKey",
	together: "togetherApiKey",
	deepseek: "deepSeekApiKey",
	qwen: "qwenApiKey",
	"qwen-code": "qwenApiKey",
	doubao: "doubaoApiKey",
	mistral: "mistralApiKey",
	litellm: "liteLlmApiKey",
	moonshot: "moonshotApiKey",
	nebius: "nebiusApiKey",
	fireworks: "fireworksApiKey",
	asksage: "asksageApiKey",
	xai: "xaiApiKey",
	sambanova: "sambanovaApiKey",
	cerebras: "cerebrasApiKey",
	groq: "groqApiKey",
	huggingface: "huggingFaceApiKey",
	"huawei-cloud-maas": "huaweiCloudMaasApiKey",
	dify: "difyApiKey",
	baseten: "basetenApiKey",
	"vercel-ai-gateway": "vercelAiGatewayApiKey",
	zai: "zaiApiKey",
	oca: "ocaApiKey",
	aihubmix: "aihubmixApiKey",
	minimax: "minimaxApiKey",
	hicap: "hicapApiKey",
	nousResearch: "nousResearchApiKey",
	sapaicore: ["sapAiCoreClientId", "sapAiCoreClientSecret"],
	cline: "clineAccountId",
} as const

/**
 * Get the provider-specific model ID key for a given provider and mode.
 * Different providers store their model IDs in different state keys.
 */
export function getProviderModelIdKey(
	provider: ApiProvider,
	mode: "act" | "plan",
): keyof import("@shared/storage/state-keys").Settings | null {
	const prefix = mode === "act" ? "actMode" : "planMode"

	const keySuffix = ProviderKeyMap[provider]
	if (keySuffix) {
		return `${prefix}${keySuffix}` as keyof import("@shared/storage/state-keys").Settings
	}

	// For providers without a specific key (anthropic, gemini, bedrock, etc.),
	// they use the generic actModeApiModelId/planModeApiModelId
	return null
}

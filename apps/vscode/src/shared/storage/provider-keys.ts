// Map providers to their specific model ID keys

import { getProviderCollectionSync } from "@cline/llms"
import { Secrets, SettingsKey } from "@shared/storage/state-keys"
import { type ApiProvider, liteLlmDefaultModelId, openRouterDefaultModelId, requestyDefaultModelId } from "../api"

const ProviderKeyMap: Partial<Record<ApiProvider, string>> = {
	openrouter: "OpenRouterModelId",
	cline: "ClineModelId",
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

export const ProviderToApiKeyMap: Partial<Record<ApiProvider, keyof Secrets | (keyof Secrets)[]>> = {
	cline: ["clineApiKey", "clineAccountId"],
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
	wandb: "wandbApiKey",
} as const

/**
 * Provider ids whose "default model" is not the SDK-declared catalog
 * default but a stored-on-`ApiConfiguration` slot belonging to another
 * provider. Dynamic-list providers (openrouter, cline, requesty, etc.)
 * write their committed ModelInfo back to their own provider field, so
 * here we expose a stable id string that downstream code can use as a
 * pre-commit placeholder.
 *
 * Anything not listed here falls through to the SDK catalog default for
 * its `providerId` (handled by `getProviderDefaultModelId` below).
 */
const NON_SDK_PROVIDER_DEFAULTS: Partial<Record<ApiProvider, string>> = {
	openrouter: openRouterDefaultModelId,
	cline: openRouterDefaultModelId,
	together: openRouterDefaultModelId,
	aihubmix: openRouterDefaultModelId,
	"vercel-ai-gateway": openRouterDefaultModelId,
	litellm: liteLlmDefaultModelId,
	oca: liteLlmDefaultModelId,
	requesty: requestyDefaultModelId,
	// Local-only providers have no remote default to nominate.
	ollama: "",
	lmstudio: "",
	hicap: "",
}

/**
 * Get the provider-specific model ID key for a given provider and mode.
 * Different providers store their model IDs in different state keys.
 */
export function getProviderModelIdKey(provider: ApiProvider, mode: "act" | "plan"): SettingsKey {
	const keySuffix = ProviderKeyMap[provider]
	if (keySuffix) {
		// E.g. actModeOpenAiModelId, planModeOpenAiModelId, etc.
		return `${mode}Mode${keySuffix}` as SettingsKey
	}

	// For providers without a specific key (anthropic, gemini, bedrock, etc.),
	// they use the generic actModeApiModelId/planModeApiModelId
	return `${mode}ModeApiModelId`
}

/**
 * Resolve the canonical "default model id" for a provider.
 *
 * 1. Hardcoded overrides for dynamic-list providers / local-only providers
 *    (see `NON_SDK_PROVIDER_DEFAULTS`).
 * 2. SDK catalog default for everything else, looked up synchronously via
 *    `getProviderCollectionSync(provider).provider.defaultModelId`.
 * 3. Empty string when the SDK has no entry for `provider`.
 */
export function getProviderDefaultModelId(provider: ApiProvider): string | null {
	const override = NON_SDK_PROVIDER_DEFAULTS[provider]
	if (override !== undefined) {
		return override
	}
	const collection = getProviderCollectionSync(provider)
	return collection?.provider.defaultModelId ?? ""
}

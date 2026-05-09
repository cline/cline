import {
	ApiConfiguration,
	ApiProvider,
	anthropicDefaultModelId,
	anthropicModels,
	askSageDefaultModelId,
	askSageModels,
	basetenDefaultModelId,
	basetenModels,
	bedrockDefaultModelId,
	bedrockModels,
	cerebrasDefaultModelId,
	cerebrasModels,
	claudeCodeDefaultModelId,
	claudeCodeModels,
	deepSeekDefaultModelId,
	deepSeekModels,
	doubaoDefaultModelId,
	doubaoModels,
	fireworksDefaultModelId,
	fireworksModels,
	geminiDefaultModelId,
	geminiModels,
	groqDefaultModelId,
	groqModels,
	hicapModelInfoSaneDefaults,
	huaweiCloudMaasDefaultModelId,
	huaweiCloudMaasModels,
	huggingFaceDefaultModelId,
	huggingFaceModels,
	internationalQwenDefaultModelId,
	internationalQwenModels,
	internationalZAiDefaultModelId,
	internationalZAiModels,
	liteLlmModelInfoSaneDefaults,
	ModelInfo,
	mainlandQwenDefaultModelId,
	mainlandQwenModels,
	mainlandZAiDefaultModelId,
	mainlandZAiModels,
	minimaxDefaultModelId,
	minimaxModels,
	mistralDefaultModelId,
	mistralModels,
	moonshotDefaultModelId,
	moonshotModels,
	nebiusDefaultModelId,
	nebiusModels,
	nousResearchDefaultModelId,
	nousResearchModels,
	openAiCodexDefaultModelId,
	openAiCodexModels,
	openAiModelInfoSaneDefaults,
	openAiNativeDefaultModelId,
	openAiNativeModels,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	qwenCodeDefaultModelId,
	qwenCodeModels,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
	sambanovaDefaultModelId,
	sambanovaModels,
	sapAiCoreDefaultModelId,
	sapAiCoreModels,
	vertexDefaultModelId,
	vertexModels,
	wandbDefaultModelId,
	wandbModels,
	xaiDefaultModelId,
	xaiModels,
} from "@shared/api"
import { Mode } from "@shared/storage/types"
import type { ModeConfigSettings } from "@shared/storage/state-keys"
import * as reasoningSupport from "@shared/utils/reasoning-support"

export function supportsReasoningEffortForModelId(modelId?: string, _allowShortOpenAiIds = false): boolean {
	return reasoningSupport.supportsReasoningEffortForModel(modelId)
}

/**
 * Returns the static model list for a provider.
 * For providers with dynamic models (openrouter, cline, ollama, etc.), returns undefined.
 * Some providers depend on configuration (qwen, zai) for region-specific models.
 */
export function getModelsForProvider(
	provider: ApiProvider,
	apiConfiguration?: ApiConfiguration,
	dynamicModels: { liteLlmModels?: Record<string, ModelInfo>; basetenModels?: Record<string, ModelInfo> } = {},
): Record<string, ModelInfo> | undefined {
	switch (provider) {
		case "anthropic":
			return anthropicModels
		case "claude-code":
			return claudeCodeModels
		case "bedrock":
			return bedrockModels
		case "vertex":
			return vertexModels
		case "gemini":
			return geminiModels
		case "openai-native":
			return openAiNativeModels
		case "openai-codex":
			return openAiCodexModels
		case "deepseek":
			return deepSeekModels
		case "qwen":
			return apiConfiguration?.qwenApiLine === "china" ? mainlandQwenModels : internationalQwenModels
		case "qwen-code":
			return qwenCodeModels
		case "doubao":
			return doubaoModels
		case "mistral":
			return mistralModels
		case "asksage":
			return askSageModels
		case "xai":
			return xaiModels
		case "moonshot":
			return moonshotModels
		case "nebius":
			return nebiusModels
		case "wandb":
			return wandbModels
		case "sambanova":
			return sambanovaModels
		case "cerebras":
			return cerebrasModels
		case "groq":
			return groqModels
		case "baseten":
			return dynamicModels?.basetenModels || basetenModels
		case "sapaicore":
			return sapAiCoreModels
		case "huawei-cloud-maas":
			return huaweiCloudMaasModels
		case "zai":
			return apiConfiguration?.zaiApiLine === "china" ? mainlandZAiModels : internationalZAiModels
		case "fireworks":
			return fireworksModels
		case "minimax":
			return minimaxModels
		case "huggingface":
			return huggingFaceModels
		case "nousResearch":
			return nousResearchModels
		case "litellm":
			return dynamicModels?.liteLlmModels
		// Providers with dynamic models - return undefined
		case "openrouter":
		case "cline":
		case "openai":
		case "ollama":
		case "lmstudio":
		case "vscode-lm":
		case "requesty":
		case "hicap":
		case "dify":
		case "vercel-ai-gateway":
		case "oca":
		case "aihubmix":
		case "together":
		default:
			return undefined
	}
}

/**
 * Interface for normalized API configuration
 */
export interface NormalizedApiConfig {
	selectedProvider: ApiProvider
	selectedModelId: string
	selectedModelInfo: ModelInfo
}

/**
 * Normalizes API configuration to ensure consistent values
 */
export function normalizeApiConfiguration(
	config: ApiConfiguration | undefined,
	mode: Mode,
): NormalizedApiConfig {
	const mc = mode === "plan" ? config?.planConfig : config?.actConfig
	return {
		selectedProvider: mc?.apiProvider ?? "anthropic",
		selectedModelId: mc?.modelId ?? "",
		selectedModelInfo: mc?.modelInfo ?? {} as ModelInfo,
	}
}

/**
 * Gets mode-specific configuration from API configuration
 */
export function getModeSpecificFields(apiConfiguration: ApiConfiguration | undefined, mode: Mode): ModeConfigSettings {
	return (mode === "plan" ? apiConfiguration?.planConfig : apiConfiguration?.actConfig) ?? ({} as ModeConfigSettings)
}



export { filterOpenRouterModelIds } from "@shared/utils/model-filters"

// Helper to get provider-specific configuration info and empty state guidance
export const getProviderInfo = (
	provider: ApiProvider,
	apiConfiguration: any,
	effectiveMode: "plan" | "act",
): { modelId?: string; baseUrl?: string; helpText: string } => {
	const config = effectiveMode === "plan" ? apiConfiguration?.planConfig : apiConfiguration?.actConfig
	switch (provider) {
		case "baseten":
			return {
				modelId: config?.modelId,
				baseUrl: apiConfiguration.basetenBaseUrl,
				helpText: "Start Baseten and load a model to begin",
			}
		case "lmstudio":
			return {
				modelId: config?.modelId,
				baseUrl: apiConfiguration.lmStudioBaseUrl,
				helpText: "Start LM Studio and load a model to begin",
			}
		case "ollama":
			return {
				modelId: config?.modelId,
				baseUrl: apiConfiguration.ollamaBaseUrl,
				helpText: "Run `ollama serve` and pull a model",
			}
		case "litellm":
			return {
				modelId: config?.modelId,
				baseUrl: apiConfiguration.liteLlmBaseUrl,
				helpText: "Add your LiteLLM proxy URL in settings",
			}
		case "openai":
			return {
				modelId: config?.modelId,
				baseUrl: apiConfiguration.openAiBaseUrl,
				helpText: "Add your OpenAI API key and endpoint",
			}
		case "vscode-lm":
			return {
				modelId: undefined,
				baseUrl: undefined,
				helpText: "Select a VS Code language model from settings",
			}
		case "requesty":
			return {
				modelId: config?.modelId,
				baseUrl: apiConfiguration.requestyBaseUrl,
				helpText: "Add your Requesty API key in settings",
			}
		case "together":
			return {
				modelId: config?.modelId,
				baseUrl: undefined,
				helpText: "Add your Together AI API key in settings",
			}
		case "dify":
			return {
				modelId: undefined,
				baseUrl: apiConfiguration.difyBaseUrl,
				helpText: "Configure your Dify workflow URL and API key",
			}
		case "hicap":
			return {
				modelId: config?.modelId,
				baseUrl: undefined,
				helpText: "Add your HiCap API key in settings",
			}
		case "oca":
			return {
				modelId: config?.modelId,
				baseUrl: apiConfiguration.ocaBaseUrl,
				helpText: "Configure your OCA endpoint in settings",
			}
		case "aihubmix":
			return {
				modelId: config?.modelId,
				baseUrl: apiConfiguration.aihubmixBaseUrl,
				helpText: "Add your AIHubMix API key in settings",
			}
		default:
			return {
				modelId: undefined,
				baseUrl: undefined,
				helpText: "Configure this provider in model settings",
			}
	}
}

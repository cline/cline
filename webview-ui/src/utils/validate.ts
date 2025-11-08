import { ApiConfiguration, ModelInfo, openRouterDefaultModelId } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { t } from "i18next"
import { getModeSpecificFields } from "@/components/settings/utils/providerUtils"

export function validateApiConfiguration(currentMode: Mode, apiConfiguration?: ApiConfiguration): string | undefined {
	if (apiConfiguration) {
		const {
			apiProvider,
			openAiModelId,
			requestyModelId,
			togetherModelId,
			ollamaModelId,
			lmStudioModelId,
			vsCodeLmModelSelector,
		} = getModeSpecificFields(apiConfiguration, currentMode)

		switch (apiProvider) {
			case "anthropic":
				if (!apiConfiguration.apiKey) {
					return t("validation.api_key_required")
				}
				break
			case "bedrock":
				if (!apiConfiguration.awsRegion) {
					return t("validation.region_required")
				}
				break
			case "openrouter":
				if (!apiConfiguration.openRouterApiKey) {
					return t("validation.api_key_required")
				}
				break
			case "vertex":
				if (!apiConfiguration.vertexProjectId || !apiConfiguration.vertexRegion) {
					return t("validation.project_id_region_required")
				}
				break
			case "gemini":
				if (!apiConfiguration.geminiApiKey) {
					return t("validation.api_key_required")
				}
				break
			case "openai-native":
				if (!apiConfiguration.openAiNativeApiKey) {
					return t("validation.api_key_required")
				}
				break
			case "deepseek":
				if (!apiConfiguration.deepSeekApiKey) {
					return t("validation.api_key_required")
				}
				break
			case "xai":
				if (!apiConfiguration.xaiApiKey) {
					return t("validation.api_key_required")
				}
				break
			case "qwen":
				if (!apiConfiguration.qwenApiKey) {
					return t("validation.api_key_required")
				}
				break
			case "doubao":
				if (!apiConfiguration.doubaoApiKey) {
					return t("validation.api_key_required")
				}
				break
			case "mistral":
				if (!apiConfiguration.mistralApiKey) {
					return t("validation.api_key_required")
				}
				break
			case "cline":
				break
			case "openai":
				if (!apiConfiguration.openAiBaseUrl || !apiConfiguration.openAiApiKey || !openAiModelId) {
					return t("validation.base_url_api_key_model_required")
				}
				break
			case "requesty":
				if (!apiConfiguration.requestyApiKey) {
					return t("validation.api_key_required")
				}
				break
			case "fireworks":
				if (!apiConfiguration.fireworksApiKey) {
					return t("validation.api_key_required")
				}
				break
			case "together":
				if (!apiConfiguration.togetherApiKey || !togetherModelId) {
					return t("validation.api_key_required")
				}
				break
			case "ollama":
				if (!ollamaModelId) {
					return t("validation.model_id_required")
				}
				break
			case "lmstudio":
				if (!lmStudioModelId) {
					return t("validation.model_id_required")
				}
				break
			case "vscode-lm":
				if (!vsCodeLmModelSelector) {
					return t("validation.model_selector_required")
				}
				break
			case "moonshot":
				if (!apiConfiguration.moonshotApiKey) {
					return t("validation.api_key_required")
				}
				break
			case "nebius":
				if (!apiConfiguration.nebiusApiKey) {
					return t("validation.api_key_required")
				}
				break
			case "asksage":
				if (!apiConfiguration.asksageApiKey) {
					return t("validation.api_key_required")
				}
				break
			case "sambanova":
				if (!apiConfiguration.sambanovaApiKey) {
					return t("validation.api_key_required")
				}
				break
			case "sapaicore":
				if (!apiConfiguration.sapAiCoreBaseUrl) {
					return t("validation.sap_base_url_required")
				}
				if (!apiConfiguration.sapAiCoreClientId) {
					return t("validation.sap_client_id_required")
				}
				if (!apiConfiguration.sapAiCoreClientSecret) {
					return t("validation.sap_client_secret_required")
				}
				if (!apiConfiguration.sapAiCoreTokenUrl) {
					return t("validation.sap_token_url_required")
				}
				break
			case "zai":
				if (!apiConfiguration.zaiApiKey) {
					return t("validation.api_key_required")
				}
				break
			case "dify":
				if (!apiConfiguration.difyBaseUrl) {
					return t("validation.dify_base_url_required")
				}
				if (!apiConfiguration.difyApiKey) {
					return t("validation.api_key_required")
				}
				break
			case "minimax":
				if (!apiConfiguration.minimaxApiKey) {
					return t("validation.api_key_required")
				}
				break
			case "hicap":
				if (!apiConfiguration.hicapApiKey) {
					return t("validation.hicap_api_key_required")
				}
				break
		}
	}
	return undefined
}

export function validateModelId(
	currentMode: Mode,
	apiConfiguration?: ApiConfiguration,
	openRouterModels?: Record<string, ModelInfo>,
): string | undefined {
	if (apiConfiguration) {
		const { apiProvider, openRouterModelId } = getModeSpecificFields(apiConfiguration, currentMode)
		switch (apiProvider) {
			case "openrouter":
			case "cline":
				const modelId = openRouterModelId || openRouterDefaultModelId // in case the user hasn't changed the model id, it will be undefined by default
				if (!modelId) {
					return t("validation.model_id_required")
				}
				if (modelId.startsWith("@preset/")) {
					break
				}
				if (openRouterModels && !Object.keys(openRouterModels).includes(modelId)) {
					// even if the model list endpoint failed, extensionstatecontext will always have the default model info
					return t("validation.model_not_available")
				}
				break
		}
	}
	return undefined
}

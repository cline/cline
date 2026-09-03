import { ApiConfiguration } from "@shared/api"
import { Mode } from "@shared/storage/types"
import { getModeSpecificFields } from "@/components/settings/utils/providerUtils"
import { i18n } from "@/i18n"

export function validateApiConfiguration(currentMode: Mode, apiConfiguration?: ApiConfiguration): string | undefined {
	if (apiConfiguration) {
		const { apiProvider, openAiModelId, togetherModelId, ollamaModelId, lmStudioModelId, vsCodeLmModelSelector } =
			getModeSpecificFields(apiConfiguration, currentMode)

		switch (apiProvider) {
			case "anthropic":
				if (!apiConfiguration.apiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "bedrock":
				if (!apiConfiguration.awsRegion) {
					return i18n.t("settings:validation.awsRegionRequired")
				}
				break
			case "openrouter":
				if (!apiConfiguration.openRouterApiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "vertex":
				if (!apiConfiguration.vertexProjectId || !apiConfiguration.vertexRegion) {
					return i18n.t("settings:validation.googleCloudConfigRequired")
				}
				break
			case "gemini":
				if (!apiConfiguration.geminiApiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "openai-native":
				if (!apiConfiguration.openAiNativeApiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "deepseek":
				if (!apiConfiguration.deepSeekApiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "xai":
				if (!apiConfiguration.xaiApiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "qwen":
				if (!apiConfiguration.qwenApiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "doubao":
				if (!apiConfiguration.doubaoApiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "mistral":
				if (!apiConfiguration.mistralApiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "cline":
				break
			case "openai-codex":
				// Authentication is handled via OAuth, not API key
				// Validation happens at runtime in the handler
				break
			case "openai":
				if (
					!apiConfiguration.openAiBaseUrl ||
					(!apiConfiguration.openAiApiKey && !apiConfiguration.azureIdentity) ||
					!openAiModelId
				) {
					return i18n.t("settings:validation.openAiConfigRequired")
				}
				break
			case "requesty":
				if (!apiConfiguration.requestyApiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "fireworks":
				if (!apiConfiguration.fireworksApiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "together":
				if (!apiConfiguration.togetherApiKey || !togetherModelId) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "ollama":
				if (!ollamaModelId) {
					return i18n.t("settings:validation.modelIdRequired")
				}
				break
			case "lmstudio":
				if (!lmStudioModelId) {
					return i18n.t("settings:validation.modelIdRequired")
				}
				break
			case "vscode-lm":
				if (!vsCodeLmModelSelector) {
					return i18n.t("settings:validation.modelSelectorRequired")
				}
				break
			case "moonshot":
				if (!apiConfiguration.moonshotApiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "nebius":
				if (!apiConfiguration.nebiusApiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "asksage":
				if (!apiConfiguration.asksageApiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "sambanova":
				if (!apiConfiguration.sambanovaApiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "sapaicore":
				if (!apiConfiguration.sapAiCoreBaseUrl) {
					return i18n.t("settings:validation.baseUrlRequired")
				}
				if (!apiConfiguration.sapAiCoreClientId) {
					return i18n.t("settings:validation.clientIdRequired")
				}
				if (!apiConfiguration.sapAiCoreClientSecret) {
					return i18n.t("settings:validation.clientSecretRequired")
				}
				if (!apiConfiguration.sapAiCoreTokenUrl) {
					return i18n.t("settings:validation.authUrlRequired")
				}
				break
			case "zai":
				if (!apiConfiguration.zaiApiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "dify":
				if (!apiConfiguration.difyBaseUrl) {
					return i18n.t("settings:validation.baseUrlRequired")
				}
				if (!apiConfiguration.difyApiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "minimax":
				if (!apiConfiguration.minimaxApiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "hicap":
				if (!apiConfiguration.hicapApiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
			case "wandb":
				if (!apiConfiguration.wandbApiKey) {
					return i18n.t("settings:validation.apiKeyRequired")
				}
				break
		}
	}
	return undefined
}

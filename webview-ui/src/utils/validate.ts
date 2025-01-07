import { ApiConfiguration, openRouterDefaultModelId, ApiProvider } from "../../../src/shared/api"
import { ModelInfo } from "../../../src/shared/api"

export function validateApiConfiguration(apiConfiguration?: ApiConfiguration): string | undefined {
	if (apiConfiguration) {
		switch (apiConfiguration.apiProvider) {
			case "anthropic":
				if (!apiConfiguration.apiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "bedrock":
				if (!apiConfiguration.awsRegion) {
					return "You must choose a region to use with AWS Bedrock."
				}
				break
			case "openrouter":
				if (!apiConfiguration.openRouterApiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "vertex":
				if (!apiConfiguration.vertexProjectId || !apiConfiguration.vertexRegion) {
					return "You must provide a valid Google Cloud Project ID and Region."
				}
				break
			case "gemini":
				if (!apiConfiguration.geminiApiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "openai-native":
				if (!apiConfiguration.openAiNativeApiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "deepseek":
				if (!apiConfiguration.deepSeekApiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "openai":
				if (!apiConfiguration.openAiBaseUrl || !apiConfiguration.openAiApiKey || !apiConfiguration.openAiModelId) {
					return "You must provide a valid base URL, API key, and model ID."
				}
				break
			case "ollama":
				if (!apiConfiguration.ollamaModelId) {
					return "You must provide a valid model ID."
				}
				break
			case "lmstudio":
				if (!apiConfiguration.lmStudioModelId) {
					return "You must provide a valid model ID."
				}
				break
			case "alibabacloud":
				if (!apiConfiguration.alibabaCloudApiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
		}
	}
	return undefined
}

export function validateModelId(
	apiConfiguration?: ApiConfiguration,
	openRouterModels?: Record<string, ModelInfo>,
): string | undefined {
	if (apiConfiguration) {
		switch (apiConfiguration.apiProvider) {
			case "openrouter":
				const modelId = apiConfiguration.openRouterModelId || openRouterDefaultModelId // in case the user hasn't changed the model id, it will be undefined by default
				if (!modelId) {
					return "You must provide a model ID."
				}
				if (openRouterModels && !Object.keys(openRouterModels).includes(modelId)) {
					// even if the model list endpoint failed, extensionstatecontext will always have the default model info
					return "The model ID you provided is not available. Please choose a different model."
				}
				break
		}
	}
	return undefined
}

export const validateApiKey = (
	provider: ApiProvider, 
	apiKey: string
): boolean => {
	switch (provider) {
		case "anthropic":
		case "openrouter":
		case "gemini":
		case "openai-native":
		case "deepseek":
		case "openai":
			return apiKey.trim().length > 0;
		case "alibabacloud":
			return apiKey.trim().length > 10 && apiKey.startsWith('sk-');
		default:
			return false;
	}
}

export const validateApiConfigurationNew = (
	provider: ApiProvider, 
	configuration: ApiConfiguration
): boolean => {
	switch (provider) {
		case "anthropic":
		case "openrouter":
		case "gemini":
		case "openai-native":
		case "deepseek":
		case "openai":
			return !!(
				configuration.apiKey && 
				validateApiKey(provider, configuration.apiKey)
			);
		case "alibabacloud":
			return !!(
				configuration.alibabaCloudApiKey && 
				validateApiKey("alibabacloud", configuration.alibabaCloudApiKey)
			);
		default:
			return false;
	}
}

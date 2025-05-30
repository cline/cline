import { ApiConfiguration, openRouterDefaultModelId, ModelInfo } from "@shared/api"

export function validateApiConfiguration(apiConfiguration?: ApiConfiguration): string | undefined {
	if (apiConfiguration) {
		switch (apiConfiguration.apiProvider) {
			case "anthropic":
				if (!apiConfiguration.anthropic?.apiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "bedrock":
				if (!apiConfiguration.aws?.region) {
					return "You must choose a region to use with AWS Bedrock."
				}
				break
			case "openrouter":
				if (!apiConfiguration.openrouter?.apiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "vertex":
				if (!apiConfiguration.vertex?.projectId || !apiConfiguration.vertex?.region) {
					return "You must provide a valid Google Cloud Project ID and Region."
				}
				break
			case "gemini":
				if (!apiConfiguration.gemini?.apiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "openai-native":
				if (!apiConfiguration.openaiNative?.apiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "deepseek":
				if (!apiConfiguration.deepseek?.apiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "xai":
				if (!apiConfiguration.xai?.apiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "qwen":
				if (!apiConfiguration.qwen?.apiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "doubao":
				if (!apiConfiguration.doubao?.apiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "mistral":
				if (!apiConfiguration.mistral?.apiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "cline":
				if (!apiConfiguration.cline?.apiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "openai":
				if (!apiConfiguration.openai?.baseUrl || !apiConfiguration.openai?.apiKey || !apiConfiguration.openai?.modelId) {
					return "You must provide a valid base URL, API key, and model ID."
				}
				break
			case "requesty":
				if (!apiConfiguration.requesty?.apiKey || !apiConfiguration.requesty?.modelId) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "fireworks":
				if (!apiConfiguration.fireworks?.apiKey || !apiConfiguration.fireworks?.modelId) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "together":
				if (!apiConfiguration.together?.apiKey || !apiConfiguration.together?.modelId) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "ollama":
				if (!apiConfiguration.ollama?.modelId) {
					return "You must provide a valid model ID."
				}
				break
			case "lmstudio":
				if (!apiConfiguration.lmstudio?.modelId) {
					return "You must provide a valid model ID."
				}
				break
			case "vscode-lm":
				if (!apiConfiguration.vscode?.modelSelector) {
					return "You must provide a valid model selector."
				}
				break
			case "nebius":
				if (!apiConfiguration.nebius?.apiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "asksage":
				if (!apiConfiguration.asksage?.apiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "sambanova":
				if (!apiConfiguration.sambanova?.apiKey) {
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
			case "cline":
				const modelId = apiConfiguration.openrouter?.modelId || openRouterDefaultModelId // in case the user hasn't changed the model id, it will be undefined by default
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

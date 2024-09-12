import { ApiConfiguration } from "../../../src/shared/api"

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
			case "openai":
				if (
					!apiConfiguration.openAiBaseUrl ||
					!apiConfiguration.openAiApiKey ||
					!apiConfiguration.openAiModelId
				) {
					return "You must provide a valid base URL, API key, and model ID."
				}
				break
			case "ollama":
				if (!apiConfiguration.ollamaModelId) {
					return "You must provide a valid model ID."
				}
				break
		}
	}
	return undefined
}

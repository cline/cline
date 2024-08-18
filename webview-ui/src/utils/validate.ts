import { ApiConfiguration } from "../../../src/shared/api"

export function validateApiConfiguration(apiConfiguration?: ApiConfiguration): string | undefined {
	if (apiConfiguration) {
		console.log("apiConfiguration details:", {
			apiProvider: apiConfiguration.apiProvider,
			apiKey: apiConfiguration.apiKey ? apiConfiguration.apiKey : undefined,
			awsAccessKey: apiConfiguration.awsAccessKey ? apiConfiguration.awsAccessKey : undefined,
			awsSecretKey: apiConfiguration.awsSecretKey ? apiConfiguration.awsSecretKey : undefined,
			awsRegion: apiConfiguration.awsRegion,
			openRouterApiKey: apiConfiguration.openRouterApiKey ? apiConfiguration.openRouterApiKey : undefined,
			vertexProjectId: apiConfiguration.vertexProjectId,
			vertexRegion: apiConfiguration.vertexRegion,
			vertexAccessToken: apiConfiguration.vertexAccessToken ? apiConfiguration.vertexAccessToken : undefined,
			customOpenAIBaseUrl: apiConfiguration.customOpenAIBaseUrl,
			customOpenAIApiKey: apiConfiguration.customOpenAIApiKey ? apiConfiguration.customOpenAIApiKey : undefined,
			geminiApiKey: apiConfiguration.geminiApiKey ? apiConfiguration.geminiApiKey : undefined,
		});
		switch (apiConfiguration.apiProvider) {
			case "anthropic":
				if (!apiConfiguration.apiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "bedrock":
				if (!apiConfiguration.awsAccessKey || !apiConfiguration.awsSecretKey || !apiConfiguration.awsRegion) {
					return "You must provide a valid AWS access key, secret key, and region."
				}
				break
			case "openrouter":
				if (!apiConfiguration.openRouterApiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "vertex":
				if ( !apiConfiguration.vertexProjectId || !apiConfiguration.vertexRegion || !apiConfiguration.vertexAccessToken) {
					return "You must provide a valid Vertex access token, project ID, and region."
				}
				break
			case "customOpenAI":
				if ( !apiConfiguration.customOpenAIBaseUrl || !apiConfiguration.customOpenAIApiKey ) {
					return "You must provide a valid API key and base URL."
				}
				break
			case "gemini":
				if (!apiConfiguration.geminiApiKey) {
					return "You must provide a valid Google Gemini API key."
				}
				break
		}
	}
	return undefined
}

export function validateMaxRequestsPerTask(maxRequestsPerTask?: string): string | undefined {
	if (maxRequestsPerTask && maxRequestsPerTask.trim()) {
		const num = Number(maxRequestsPerTask)
		if (isNaN(num) || num < 3 || num > 100) {
			return "Maximum requests must be between 3 and 100"
		}
	}
	return undefined
}
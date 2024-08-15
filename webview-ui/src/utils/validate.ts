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
				if (!apiConfiguration.awsAccessKey || !apiConfiguration.awsSecretKey || !apiConfiguration.awsRegion) {
					return "You must provide a valid AWS access key, secret key, and region."
				}
				break
			case "openrouter":
				if (!apiConfiguration.openRouterApiKey) {
					return "You must provide a valid API key or choose a different provider."
				}
				break
			case "sapaicore":
				if (!apiConfiguration.sapAiCoreBaseUrl) {
					return "You must provide a valid Base URL key or choose a different provider."
				}
				if (!apiConfiguration.sapAiCoreClientId) {
					return "You must provide a valid Client Id or choose a different provider."
				}
				if (!apiConfiguration.sapAiCoreClientSecret) {
					return "You must provide a valid Client Secret or choose a different provider."
				}
				if (!apiConfiguration.sapAiCoreTokenUrl) {
					return "You must provide a valid Aith URL or choose a different provider."
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

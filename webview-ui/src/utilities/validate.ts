import { ApiConfiguration } from "@shared/api"

export function validateApiConfiguration(apiConfiguration?: ApiConfiguration): string | undefined {
	if (apiConfiguration) {
		switch (apiConfiguration.apiProvider) {
			case "anthropic":
				if (!apiConfiguration.apiKey) {
					return "API Key cannot be empty. You must provide an API key to use Claude Dev."
				}
				break
			case "bedrock":
				if (!apiConfiguration.awsAccessKey || !apiConfiguration.awsSecretKey || !apiConfiguration.awsRegion) {
					return "AWS credentials are incomplete. You must provide an AWS access key, secret key, and region."
				}
				break
			case "openrouter":
				if (!apiConfiguration.openRouterApiKey) {
					return "API Key cannot be empty. You must provide an API key to use Claude Dev."
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

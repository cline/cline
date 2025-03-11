import { ApiConfiguration, ModelInfo } from "../../../src/shared/api"

export function validateApiConfiguration(apiConfiguration?: ApiConfiguration): string | undefined {
	if (!apiConfiguration) {
		return undefined
	}

	switch (apiConfiguration.apiProvider) {
		case "openrouter":
			if (!apiConfiguration.openRouterApiKey) {
				return "You must provide a valid API key."
			}
			break
		case "glama":
			if (!apiConfiguration.glamaApiKey) {
				return "You must provide a valid API key."
			}
			break
		case "unbound":
			if (!apiConfiguration.unboundApiKey) {
				return "You must provide a valid API key."
			}
			break
		case "requesty":
			if (!apiConfiguration.requestyApiKey) {
				return "You must provide a valid API key."
			}
			break
		case "anthropic":
			if (!apiConfiguration.apiKey) {
				return "You must provide a valid API key."
			}
			break
		case "bedrock":
			if (!apiConfiguration.awsRegion) {
				return "You must choose a region to use with AWS Bedrock."
			}
			break
		case "vertex":
			if (!apiConfiguration.vertexProjectId || !apiConfiguration.vertexRegion) {
				return "You must provide a valid Google Cloud Project ID and Region."
			}
			break
		case "gemini":
			if (!apiConfiguration.geminiApiKey) {
				return "You must provide a valid API key."
			}
			break
		case "openai-native":
			if (!apiConfiguration.openAiNativeApiKey) {
				return "You must provide a valid API key."
			}
			break
		case "mistral":
			if (!apiConfiguration.mistralApiKey) {
				return "You must provide a valid API key."
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
		case "vscode-lm":
			if (!apiConfiguration.vsCodeLmModelSelector) {
				return "You must provide a valid model selector."
			}
			break
	}

	return undefined
}
/**
 * Validates an AWS Bedrock ARN format and optionally checks if the region in the ARN matches the provided region
 * @param arn The ARN string to validate
 * @param region Optional region to check against the ARN's region
 * @returns An object with validation results: { isValid, arnRegion, errorMessage }
 */
export function validateBedrockArn(arn: string, region?: string) {
	// Validate ARN format
	const arnRegex = /^arn:aws:bedrock:([^:]+):(\d+):(foundation-model|provisioned-model|default-prompt-router)\/(.+)$/
	const match = arn.match(arnRegex)

	if (!match) {
		return {
			isValid: false,
			arnRegion: undefined,
			errorMessage: "Invalid ARN format. Please check the format requirements.",
		}
	}

	// Extract region from ARN
	const arnRegion = match[1]

	// Check if region in ARN matches provided region (if specified)
	if (region && arnRegion !== region) {
		return {
			isValid: true,
			arnRegion,
			errorMessage: `Warning: The region in your ARN (${arnRegion}) does not match your selected region (${region}). This may cause access issues. The provider will use the region from the ARN.`,
		}
	}

	// ARN is valid and region matches (or no region was provided to check against)
	return {
		isValid: true,
		arnRegion,
		errorMessage: undefined,
	}
}

export function validateModelId(
	apiConfiguration?: ApiConfiguration,
	glamaModels?: Record<string, ModelInfo>,
	openRouterModels?: Record<string, ModelInfo>,
	unboundModels?: Record<string, ModelInfo>,
	requestyModels?: Record<string, ModelInfo>,
): string | undefined {
	if (!apiConfiguration) {
		return undefined
	}

	switch (apiConfiguration.apiProvider) {
		case "openrouter":
			const modelId = apiConfiguration.openRouterModelId

			if (!modelId) {
				return "You must provide a model ID."
			}

			if (
				openRouterModels &&
				Object.keys(openRouterModels).length > 1 &&
				!Object.keys(openRouterModels).includes(modelId)
			) {
				return `The model ID (${modelId}) you provided is not available. Please choose a different model.`
			}

			break

		case "glama":
			const glamaModelId = apiConfiguration.glamaModelId

			if (!glamaModelId) {
				return "You must provide a model ID."
			}

			if (
				glamaModels &&
				Object.keys(glamaModels).length > 1 &&
				!Object.keys(glamaModels).includes(glamaModelId)
			) {
				return `The model ID (${glamaModelId}) you provided is not available. Please choose a different model.`
			}

			break

		case "unbound":
			const unboundModelId = apiConfiguration.unboundModelId

			if (!unboundModelId) {
				return "You must provide a model ID."
			}

			if (
				unboundModels &&
				Object.keys(unboundModels).length > 1 &&
				!Object.keys(unboundModels).includes(unboundModelId)
			) {
				return `The model ID (${unboundModelId}) you provided is not available. Please choose a different model.`
			}

			break

		case "requesty":
			const requestyModelId = apiConfiguration.requestyModelId

			if (!requestyModelId) {
				return "You must provide a model ID."
			}

			if (
				requestyModels &&
				Object.keys(requestyModels).length > 1 &&
				!Object.keys(requestyModels).includes(requestyModelId)
			) {
				return `The model ID (${requestyModelId}) you provided is not available. Please choose a different model.`
			}

			break
	}

	return undefined
}

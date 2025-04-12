import { ApiConfiguration, ModelInfo } from "../../../src/shared/api"
import i18next from "i18next"

export function validateApiConfiguration(apiConfiguration?: ApiConfiguration): string | undefined {
	if (!apiConfiguration) {
		return undefined
	}

	switch (apiConfiguration.apiProvider) {
		case "openrouter":
			if (!apiConfiguration.openRouterApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "glama":
			if (!apiConfiguration.glamaApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "unbound":
			if (!apiConfiguration.unboundApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "requesty":
			if (!apiConfiguration.requestyApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "anthropic":
			if (!apiConfiguration.apiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "bedrock":
			if (!apiConfiguration.awsRegion) {
				return i18next.t("settings:validation.awsRegion")
			}
			break
		case "vertex":
			if (!apiConfiguration.vertexProjectId || !apiConfiguration.vertexRegion) {
				return i18next.t("settings:validation.googleCloud")
			}
			break
		case "gemini":
			if (!apiConfiguration.geminiApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "openai-native":
			if (!apiConfiguration.openAiNativeApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "mistral":
			if (!apiConfiguration.mistralApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "openai":
			if (!apiConfiguration.openAiBaseUrl || !apiConfiguration.openAiApiKey || !apiConfiguration.openAiModelId) {
				return i18next.t("settings:validation.openAi")
			}
			break
		case "ollama":
			if (!apiConfiguration.ollamaModelId) {
				return i18next.t("settings:validation.modelId")
			}
			break
		case "lmstudio":
			if (!apiConfiguration.lmStudioModelId) {
				return i18next.t("settings:validation.modelId")
			}
			break
		case "vscode-lm":
			if (!apiConfiguration.vsCodeLmModelSelector) {
				return i18next.t("settings:validation.modelSelector")
			}
			break
	}

	return undefined
}
/**
 * Validates an Amazon Bedrock ARN format and optionally checks if the region in the ARN matches the provided region
 * @param arn The ARN string to validate
 * @param region Optional region to check against the ARN's region
 * @returns An object with validation results: { isValid, arnRegion, errorMessage }
 */
export function validateBedrockArn(arn: string, region?: string) {
	// Validate ARN format
	const arnRegex = /^arn:aws:bedrock:([^:]+):([^:]*):(?:([^/]+)\/([\w.\-:]+)|([^/]+))$/
	const match = arn.match(arnRegex)

	if (!match) {
		return {
			isValid: false,
			arnRegion: undefined,
			errorMessage: i18next.t("settings:validation.arn.invalidFormat"),
		}
	}

	// Extract region from ARN
	const arnRegion = match[1]

	// Check if region in ARN matches provided region (if specified)
	if (region && arnRegion !== region) {
		return {
			isValid: true,
			arnRegion,
			errorMessage: i18next.t("settings:validation.arn.regionMismatch", { arnRegion, region }),
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
				return i18next.t("settings:validation.modelId")
			}

			if (
				openRouterModels &&
				Object.keys(openRouterModels).length > 1 &&
				!Object.keys(openRouterModels).includes(modelId)
			) {
				return i18next.t("settings:validation.modelAvailability", { modelId })
			}

			break

		case "glama":
			const glamaModelId = apiConfiguration.glamaModelId

			if (!glamaModelId) {
				return i18next.t("settings:validation.modelId")
			}

			if (
				glamaModels &&
				Object.keys(glamaModels).length > 1 &&
				!Object.keys(glamaModels).includes(glamaModelId)
			) {
				return i18next.t("settings:validation.modelAvailability", { modelId: glamaModelId })
			}

			break

		case "unbound":
			const unboundModelId = apiConfiguration.unboundModelId

			if (!unboundModelId) {
				return i18next.t("settings:validation.modelId")
			}

			if (
				unboundModels &&
				Object.keys(unboundModels).length > 1 &&
				!Object.keys(unboundModels).includes(unboundModelId)
			) {
				return i18next.t("settings:validation.modelAvailability", { modelId: unboundModelId })
			}

			break

		case "requesty":
			const requestyModelId = apiConfiguration.requestyModelId

			if (!requestyModelId) {
				return i18next.t("settings:validation.modelId")
			}

			if (
				requestyModels &&
				Object.keys(requestyModels).length > 1 &&
				!Object.keys(requestyModels).includes(requestyModelId)
			) {
				return i18next.t("settings:validation.modelAvailability", { modelId: requestyModelId })
			}

			break
	}

	return undefined
}

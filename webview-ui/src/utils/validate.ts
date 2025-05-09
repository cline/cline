import i18next from "i18next"

import { ProviderSettings, isRouterName, RouterModels } from "@roo/shared/api"

export function validateApiConfiguration(apiConfiguration: ProviderSettings): string | undefined {
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
		case "litellm":
			if (!apiConfiguration.litellmApiKey) {
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
	const arnRegex = /^arn:aws:(?:bedrock|sagemaker):([^:]+):([^:]*):(?:([^/]+)\/([\w.\-:]+)|([^/]+))$/
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
	return { isValid: true, arnRegion, errorMessage: undefined }
}

export function validateModelId(apiConfiguration: ProviderSettings, routerModels?: RouterModels): string | undefined {
	const provider = apiConfiguration.apiProvider ?? ""

	if (!isRouterName(provider)) {
		return undefined
	}

	let modelId: string | undefined

	switch (provider) {
		case "openrouter":
			modelId = apiConfiguration.openRouterModelId
			break
		case "glama":
			modelId = apiConfiguration.glamaModelId
			break
		case "unbound":
			modelId = apiConfiguration.unboundModelId
			break
		case "requesty":
			modelId = apiConfiguration.requestyModelId
			break
		case "litellm":
			modelId = apiConfiguration.litellmModelId
			break
	}

	if (!modelId) {
		return i18next.t("settings:validation.modelId")
	}

	const models = routerModels?.[provider]

	if (models && Object.keys(models).length > 1 && !Object.keys(models).includes(modelId)) {
		return i18next.t("settings:validation.modelAvailability", { modelId })
	}

	return undefined
}

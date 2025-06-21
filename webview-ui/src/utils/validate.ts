import i18next from "i18next"

import type { ProviderSettings, OrganizationAllowList } from "@roo-code/types"

import { isRouterName, RouterModels } from "@roo/api"

export function validateApiConfiguration(
	apiConfiguration: ProviderSettings,
	routerModels?: RouterModels,
	organizationAllowList?: OrganizationAllowList,
): string | undefined {
	const keysAndIdsPresentErrorMessage = validateModelsAndKeysProvided(apiConfiguration)
	if (keysAndIdsPresentErrorMessage) {
		return keysAndIdsPresentErrorMessage
	}

	const organizationAllowListError = validateProviderAgainstOrganizationSettings(
		apiConfiguration,
		organizationAllowList,
	)
	if (organizationAllowListError) {
		return organizationAllowListError.message
	}

	return validateModelId(apiConfiguration, routerModels)
}

function validateModelsAndKeysProvided(apiConfiguration: ProviderSettings): string | undefined {
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

type ValidationError = {
	message: string
	code: "PROVIDER_NOT_ALLOWED" | "MODEL_NOT_ALLOWED"
}

function validateProviderAgainstOrganizationSettings(
	apiConfiguration: ProviderSettings,
	organizationAllowList?: OrganizationAllowList,
): ValidationError | undefined {
	if (organizationAllowList && !organizationAllowList.allowAll) {
		const provider = apiConfiguration.apiProvider
		if (!provider) return undefined

		const providerConfig = organizationAllowList.providers[provider]
		if (!providerConfig) {
			return {
				message: i18next.t("settings:validation.providerNotAllowed", { provider }),
				code: "PROVIDER_NOT_ALLOWED",
			}
		}

		if (!providerConfig.allowAll) {
			const modelId = getModelIdForProvider(apiConfiguration, provider)
			const allowedModels = providerConfig.models || []

			if (modelId && !allowedModels.includes(modelId)) {
				return {
					message: i18next.t("settings:validation.modelNotAllowed", {
						model: modelId,
						provider,
					}),
					code: "MODEL_NOT_ALLOWED",
				}
			}
		}
	}
}

function getModelIdForProvider(apiConfiguration: ProviderSettings, provider: string): string | undefined {
	switch (provider) {
		case "openrouter":
			return apiConfiguration.openRouterModelId
		case "glama":
			return apiConfiguration.glamaModelId
		case "unbound":
			return apiConfiguration.unboundModelId
		case "requesty":
			return apiConfiguration.requestyModelId
		case "litellm":
			return apiConfiguration.litellmModelId
		case "openai":
			return apiConfiguration.openAiModelId
		case "ollama":
			return apiConfiguration.ollamaModelId
		case "lmstudio":
			return apiConfiguration.lmStudioModelId
		case "vscode-lm":
			// vsCodeLmModelSelector is an object, not a string
			return apiConfiguration.vsCodeLmModelSelector?.id
		default:
			return apiConfiguration.apiModelId
	}
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
		case "ollama":
			modelId = apiConfiguration.ollamaModelId
			break
		case "lmstudio":
			modelId = apiConfiguration.lmStudioModelId
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

/**
 * Extracts model-specific validation errors from the API configuration
 * This is used to show model errors specifically in the model selector components
 */
export function getModelValidationError(
	apiConfiguration: ProviderSettings,
	routerModels?: RouterModels,
	organizationAllowList?: OrganizationAllowList,
): string | undefined {
	const modelId = getModelIdForProvider(apiConfiguration, apiConfiguration.apiProvider || "")
	const configWithModelId = {
		...apiConfiguration,
		apiModelId: modelId || "",
	}

	const orgError = validateProviderAgainstOrganizationSettings(configWithModelId, organizationAllowList)
	if (orgError && orgError.code === "MODEL_NOT_ALLOWED") {
		return orgError.message
	}

	return validateModelId(configWithModelId, routerModels)
}

/**
 * Validates API configuration but excludes model-specific errors
 * This is used for the general API error display to prevent duplication
 * when model errors are shown in the model selector
 */
export function validateApiConfigurationExcludingModelErrors(
	apiConfiguration: ProviderSettings,
	_routerModels?: RouterModels, // keeping this for compatibility with the old function
	organizationAllowList?: OrganizationAllowList,
): string | undefined {
	const keysAndIdsPresentErrorMessage = validateModelsAndKeysProvided(apiConfiguration)
	if (keysAndIdsPresentErrorMessage) {
		return keysAndIdsPresentErrorMessage
	}

	const organizationAllowListError = validateProviderAgainstOrganizationSettings(
		apiConfiguration,
		organizationAllowList,
	)

	// only return organization errors if they're not model-specific
	if (organizationAllowListError && organizationAllowListError.code === "PROVIDER_NOT_ALLOWED") {
		return organizationAllowListError.message
	}

	// skip model validation errors as they'll be shown in the model selector
	return undefined
}

/**
 * Shared utility for applying provider configuration
 * Used by both AuthView (onboarding) and SettingsPanelContent (settings)
 */

import type { ApiProvider } from "@shared/api"
import { getProviderModelIdKey, ProviderToApiKeyMap } from "@shared/storage"
import { buildApiHandler } from "@/core/api"
import type { Controller } from "@/core/controller"
import { StateManager } from "@/core/storage/StateManager"
import type { BedrockConfig } from "../components/BedrockSetup"
import { getDefaultModelId } from "../components/ModelPicker"

export interface ApplyProviderConfigOptions {
	providerId: string
	apiKey?: string
	modelId?: string // Override default model
	baseUrl?: string // For OpenAI-compatible providers
	controller?: Controller
}

/**
 * Apply provider configuration to state and rebuild API handler if needed
 */
export async function applyProviderConfig(options: ApplyProviderConfigOptions): Promise<void> {
	const { providerId, apiKey, modelId, baseUrl, controller } = options
	const stateManager = StateManager.get()

	const config: Record<string, string> = {
		actModeApiProvider: providerId,
		planModeApiProvider: providerId,
	}

	// Add model ID (use provided or fall back to default)
	// Use provider-specific model ID keys (e.g., actModeOpenRouterModelId for cline/openrouter)
	const finalModelId = modelId || getDefaultModelId(providerId)
	if (finalModelId) {
		const actModelKey = getProviderModelIdKey(providerId as ApiProvider, "act")
		const planModelKey = getProviderModelIdKey(providerId as ApiProvider, "plan")
		if (actModelKey) config[actModelKey] = finalModelId
		if (planModelKey) config[planModelKey] = finalModelId

		// For cline/openrouter, also set model info (required for getModel() to return correct model)
		if ((providerId === "cline" || providerId === "openrouter") && controller) {
			const openRouterModels = await controller.readOpenRouterModels()
			const modelInfo = openRouterModels?.[finalModelId]
			if (modelInfo) {
				stateManager.setGlobalState("actModeOpenRouterModelInfo", modelInfo)
				stateManager.setGlobalState("planModeOpenRouterModelInfo", modelInfo)
			}
		}
	}

	// Add API key if provided (maps to provider-specific field like anthropicApiKey, openAiApiKey, etc.)
	if (apiKey) {
		const keyField = ProviderToApiKeyMap[providerId as keyof typeof ProviderToApiKeyMap]
		if (keyField) {
			const fields = Array.isArray(keyField) ? keyField : [keyField]
			config[fields[0]] = apiKey
		}
	}

	// Add base URL if provided (for OpenAI-compatible providers)
	if (baseUrl) {
		config.openAiBaseUrl = baseUrl
	}

	// Save via StateManager
	stateManager.setApiConfiguration(config)
	await stateManager.flushPendingState()

	// Rebuild API handler on active task if one exists
	if (controller?.task) {
		const currentMode = stateManager.getGlobalSettingsKey("mode")
		const apiConfig = stateManager.getApiConfiguration()
		controller.task.api = buildApiHandler({ ...apiConfig, ulid: controller.task.ulid }, currentMode)
	}
}

export interface ApplyBedrockConfigOptions {
	bedrockConfig: BedrockConfig
	modelId?: string
	customModelBaseId?: string // Base model ID for custom ARN/Inference Profile (for capability detection)
	controller?: Controller
}

/**
 * Apply Bedrock provider configuration to state
 * Handles AWS-specific fields (authentication, region, credentials)
 * When customModelBaseId is provided, sets the custom model flags so the system
 * knows to use the ARN as the model ID and the base model for capability detection.
 */
export async function applyBedrockConfig(options: ApplyBedrockConfigOptions): Promise<void> {
	const { bedrockConfig, modelId, customModelBaseId, controller } = options
	const stateManager = StateManager.get()

	const config: Record<string, unknown> = {
		actModeApiProvider: "bedrock",
		planModeApiProvider: "bedrock",
		awsAuthentication: bedrockConfig.awsAuthentication,
		awsRegion: bedrockConfig.awsRegion,
		awsUseCrossRegionInference: bedrockConfig.awsUseCrossRegionInference,
	}

	// Add model ID
	const finalModelId = modelId || getDefaultModelId("bedrock")
	if (finalModelId) {
		const actModelKey = getProviderModelIdKey("bedrock" as ApiProvider, "act")
		const planModelKey = getProviderModelIdKey("bedrock" as ApiProvider, "plan")
		if (actModelKey) config[actModelKey] = finalModelId
		if (planModelKey) config[planModelKey] = finalModelId
	}

	// Handle custom model (Application Inference Profile ARN)
	if (customModelBaseId) {
		config.actModeAwsBedrockCustomSelected = true
		config.planModeAwsBedrockCustomSelected = true
		config.actModeAwsBedrockCustomModelBaseId = customModelBaseId
		config.planModeAwsBedrockCustomModelBaseId = customModelBaseId
	} else {
		// Ensure custom flags are cleared when using a standard model
		config.actModeAwsBedrockCustomSelected = false
		config.planModeAwsBedrockCustomSelected = false
	}

	// Add optional AWS credentials
	if (bedrockConfig.awsProfile !== undefined) config.awsProfile = bedrockConfig.awsProfile
	if (bedrockConfig.awsAccessKey) config.awsAccessKey = bedrockConfig.awsAccessKey
	if (bedrockConfig.awsSecretKey) config.awsSecretKey = bedrockConfig.awsSecretKey
	if (bedrockConfig.awsSessionToken) config.awsSessionToken = bedrockConfig.awsSessionToken

	// Save via StateManager
	stateManager.setApiConfiguration(config as Record<string, string>)
	await stateManager.flushPendingState()

	// Rebuild API handler on active task if one exists
	if (controller?.task) {
		const currentMode = stateManager.getGlobalSettingsKey("mode")
		const apiConfig = stateManager.getApiConfiguration()
		controller.task.api = buildApiHandler({ ...apiConfig, ulid: controller.task.ulid }, currentMode)
	}
}

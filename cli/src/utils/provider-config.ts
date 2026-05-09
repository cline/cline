/**
 * Shared utility for applying provider configuration
 * Used by both AuthView (onboarding) and SettingsPanelContent (settings)
 */

import type { ApiConfiguration, ApiProvider } from "@shared/api"
import { ProviderToApiKeyMap } from "@shared/storage"
import { type ModeConfigSettings } from "@shared/storage"
import { buildApiHandler } from "@/core/api"
import type { Controller } from "@/core/controller"
import { refreshOpenRouterModels } from "@/core/controller/models/refreshOpenRouterModels"
import { refreshVercelAiGatewayModels } from "@/core/controller/models/refreshVercelAiGatewayModels"
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
	const provider = providerId as ApiProvider

	const planConfig: ModeConfigSettings = { apiProvider: provider }
	const actConfig: ModeConfigSettings = { apiProvider: provider }

	// Add model ID (use provided or fall back to default)
	const finalModelId = modelId || getDefaultModelId(providerId)
	if (finalModelId) {
		planConfig.modelId = finalModelId
		actConfig.modelId = finalModelId

		// Fetch model info from the provider API (not just disk cache) so headless
		// CLI auth gets correct maxTokens, thinkingConfig, etc.
		if ((providerId === "cline" || providerId === "openrouter") && controller) {
			const openRouterModels = await refreshOpenRouterModels(controller)
			const modelInfo = openRouterModels?.[finalModelId]
			if (modelInfo) {
				planConfig.modelInfo = modelInfo
				actConfig.modelInfo = modelInfo
			}
		} else if (providerId === "vercel-ai-gateway" && controller) {
			const vercelModels = await refreshVercelAiGatewayModels(controller)
			const modelInfo = vercelModels?.[finalModelId]
			if (modelInfo) {
				planConfig.modelInfo = modelInfo
				actConfig.modelInfo = modelInfo
			}
		}
	}

	// Build API configuration with nested mode configs
	const apiConfig: Partial<ApiConfiguration> = {
		planConfig,
		actConfig,
	}

	// Add API key if provided (maps to provider-specific field like anthropicApiKey, openAiApiKey, etc.)
	if (apiKey) {
		const keyField = ProviderToApiKeyMap[providerId as keyof typeof ProviderToApiKeyMap]
		if (keyField) {
			const fields = Array.isArray(keyField) ? keyField : [keyField]
			;(apiConfig as Record<string, unknown>)[fields[0]] = apiKey
		}
	}

	// Add base URL if provided (for OpenAI-compatible providers)
	if (baseUrl) {
		apiConfig.openAiBaseUrl = baseUrl
	}

	// Save via StateManager
	stateManager.setApiConfiguration(apiConfig as ApiConfiguration)
	await stateManager.flushPendingState()

	// Rebuild API handler on active task if one exists
	if (controller?.task) {
		const currentMode = stateManager.getGlobalSettingsKey("mode")
		const config = stateManager.getApiConfiguration()
		controller.task.api = buildApiHandler({ ...config, ulid: controller.task.ulid }, currentMode)
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

	const planConfig: ModeConfigSettings = { apiProvider: "bedrock" }
	const actConfig: ModeConfigSettings = { apiProvider: "bedrock" }

	// Add model ID
	const finalModelId = modelId || getDefaultModelId("bedrock")
	if (finalModelId) {
		planConfig.modelId = finalModelId
		actConfig.modelId = finalModelId
	}

	// Handle custom model (Application Inference Profile ARN)
	if (customModelBaseId) {
		planConfig.awsBedrockCustomSelected = true
		actConfig.awsBedrockCustomSelected = true
		planConfig.awsBedrockCustomModelBaseId = customModelBaseId
		actConfig.awsBedrockCustomModelBaseId = customModelBaseId
	} else {
		// Ensure custom flags are cleared when using a standard model
		planConfig.awsBedrockCustomSelected = false
		actConfig.awsBedrockCustomSelected = false
	}

	// Build API configuration with nested mode configs
	const apiConfig: Record<string, unknown> = {
		planConfig,
		actConfig,
		awsAuthentication: bedrockConfig.awsAuthentication,
		awsRegion: bedrockConfig.awsRegion,
		awsUseCrossRegionInference: bedrockConfig.awsUseCrossRegionInference,
	}

	// Add optional AWS credentials
	if (bedrockConfig.awsProfile !== undefined) apiConfig.awsProfile = bedrockConfig.awsProfile
	if (bedrockConfig.awsAccessKey) apiConfig.awsAccessKey = bedrockConfig.awsAccessKey
	if (bedrockConfig.awsSecretKey) apiConfig.awsSecretKey = bedrockConfig.awsSecretKey
	if (bedrockConfig.awsSessionToken) apiConfig.awsSessionToken = bedrockConfig.awsSessionToken

	// Save via StateManager
	stateManager.setApiConfiguration(apiConfig as ApiConfiguration)
	await stateManager.flushPendingState()

	// Rebuild API handler on active task if one exists
	if (controller?.task) {
		const currentMode = stateManager.getGlobalSettingsKey("mode")
		const config = stateManager.getApiConfiguration()
		controller.task.api = buildApiHandler({ ...config, ulid: controller.task.ulid }, currentMode)
	}
}

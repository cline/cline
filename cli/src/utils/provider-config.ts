/**
 * Shared utility for applying provider configuration
 * Used by both AuthView (onboarding) and SettingsPanelContent (settings)
 */

import type { ApiProvider } from "@shared/api"
import { getProviderModelIdKey, ProviderToApiKeyMap } from "@shared/storage"
import { buildApiHandler } from "@/core/api"
import type { Controller } from "@/core/controller"
import { StateManager } from "@/core/storage/StateManager"
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

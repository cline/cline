import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import { GlobalStateAndSettings } from "@/shared/storage/state-keys"
import type { Controller } from "../index"
import { refreshBasetenModels } from "../models/refreshBasetenModels"
import { refreshGroqModels } from "../models/refreshGroqModels"
import { refreshHicapModels } from "../models/refreshHicapModels"
import { refreshLiteLlmModels } from "../models/refreshLiteLlmModels"
import { refreshOpenRouterModels } from "../models/refreshOpenRouterModels"
import { ensureSharedModeApiConfiguration } from "../models/sharedModeConfiguration"
import { sendOpenRouterModelsEvent } from "../models/subscribeToOpenRouterModels"

/**
 * Initialize webview when it launches
 * @param controller The controller instance
 * @param request The empty request
 * @returns Empty response
 */
export async function initializeWebview(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		ensureSharedModeApiConfiguration(controller)

		// Post last cached models as soon as possible for immediate availability in the UI
		const lastCachedModels = await controller.readOpenRouterModels()
		if (lastCachedModels) {
			sendOpenRouterModelsEvent(OpenRouterCompatibleModelInfo.create({ models: lastCachedModels }))
		}

		// Refresh OpenRouter models from API
		refreshOpenRouterModels(controller).then(async (models) => {
			if (models && Object.keys(models).length > 0) {
				// Update model info in state (this needs to be done here since we don't want to update state while settings is open, and we may refresh models there)
				const apiConfiguration = controller.stateManager.getApiConfiguration()
				const planModelId = apiConfiguration.planModeOpenRouterModelId
				const actModelId = apiConfiguration.actModeOpenRouterModelId
				const updates: Partial<GlobalStateAndSettings> = {}

				if (planModelId && models[planModelId]) {
					updates.planModeOpenRouterModelInfo = models[planModelId]
				}
				if (actModelId && models[actModelId]) {
					updates.actModeOpenRouterModelInfo = models[actModelId]
				}
				if (Object.keys(updates).length > 0) {
					controller.stateManager.setGlobalStateBatch(updates)
					await controller.postStateToWebview()
				}
			}
		})

		refreshGroqModels(controller).then(async (models) => {
			if (models && Object.keys(models).length > 0) {
				// Update model info in state for Groq (this needs to be done here since we don't want to update state while settings is open, and we may refresh models there)
				const apiConfiguration = controller.stateManager.getApiConfiguration()
				const planModelId = apiConfiguration.planModeGroqModelId
				const actModelId = apiConfiguration.actModeGroqModelId
				const updates: Partial<GlobalStateAndSettings> = {}

				if (planModelId && models[planModelId]) {
					updates.planModeGroqModelInfo = models[planModelId]
				}
				if (actModelId && models[actModelId]) {
					updates.actModeGroqModelInfo = models[actModelId]
				}
				if (Object.keys(updates).length > 0) {
					controller.stateManager.setGlobalStateBatch(updates)
					await controller.postStateToWebview()
				}
			}
		})

		refreshBasetenModels(controller).then(async (models) => {
			if (models && Object.keys(models).length > 0) {
				// Update model info in state for Baseten (this needs to be done here since we don't want to update state while settings is open, and we may refresh models there)
				const apiConfiguration = controller.stateManager.getApiConfiguration()
				const planModelId = apiConfiguration.planModeBasetenModelId
				const actModelId = apiConfiguration.actModeBasetenModelId
				const updates: Partial<GlobalStateAndSettings> = {}

				if (planModelId && models[planModelId]) {
					updates.planModeBasetenModelInfo = models[planModelId]
				}
				if (actModelId && models[actModelId]) {
					updates.actModeBasetenModelInfo = models[actModelId]
				}
				if (Object.keys(updates).length > 0) {
					controller.stateManager.setGlobalStateBatch(updates)
					await controller.postStateToWebview()
				}
			}
		})

		// Refresh Hicap models from API
		refreshHicapModels(controller, EmptyRequest.create()).then(async (response) => {
			if (response && response.models) {
				// Update model info in state (this needs to be done here since we don't want to update state while settings is open, and we may refresh models there)
				const apiConfiguration = controller.stateManager.getApiConfiguration()
				const planModelId = apiConfiguration.planModeHicapModelId
				const actModelId = apiConfiguration.actModeHicapModelId
				const updates: Partial<GlobalStateAndSettings> = {}

				if (planModelId && response.models[planModelId]) {
					updates.planModeHicapModelInfo = response.models[planModelId]
				}
				if (actModelId && response.models[actModelId]) {
					updates.actModeHicapModelInfo = response.models[actModelId]
				}
				if (Object.keys(updates).length > 0) {
					controller.stateManager.setGlobalStateBatch(updates)
					await controller.postStateToWebview()
				}
			}
		})

		const liteLlmBaseUrl = controller.stateManager.getGlobalSettingsKey("liteLlmBaseUrl")
		const liteLlmApiKey = controller.stateManager.getSecretKey("liteLlmApiKey")
		if (liteLlmBaseUrl && liteLlmApiKey) {
			await refreshLiteLlmModels()
		}

		// GUI relies on model info to be up-to-date to provide the most accurate pricing, so we need to fetch the latest details on launch.
		// We do this for all users since many users switch between api providers and if they were to switch back to openrouter it would be showing outdated model info if we hadn't retrieved the latest at this point
		// (see normalizeApiConfiguration > openrouter)
		// Prefetch OpenRouter models

		// Initialize telemetry service with user's current setting
		controller.getStateToPostToWebview().then((state) => {
			const { telemetrySetting } = state
			const isOptedIn = telemetrySetting !== "disabled"
			telemetryService.updateTelemetryState(isOptedIn)
		})

		return Empty.create({})
	} catch (error) {
		Logger.error("Failed to initialize webview:", error)
		// Return empty response even on error to not break the frontend
		return Empty.create({})
	}
}

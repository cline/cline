import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { readMcpMarketplaceCatalogFromCache } from "@/core/storage/disk"
import { telemetryService } from "@/services/telemetry"
import { GlobalStateAndSettings } from "@/shared/storage/state-keys"
import type { Controller } from "../index"
import { sendMcpMarketplaceCatalogEvent } from "../mcp/subscribeToMcpMarketplaceCatalog"
import { refreshBasetenModels } from "../models/refreshBasetenModels"
import { refreshGroqModels } from "../models/refreshGroqModels"
import { refreshHicapModels } from "../models/refreshHicapModels"
import { refreshLiteLlmModels } from "../models/refreshLiteLlmModels"
import { refreshOpenRouterModels } from "../models/refreshOpenRouterModels"
import { sendOpenRouterModelsEvent } from "../models/subscribeToOpenRouterModels"

/**
 * Initialize webview when it launches
 * @param controller The controller instance
 * @param request The empty request
 * @returns Empty response
 */
export async function initializeWebview(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
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
				const planActSeparateModelsSetting = controller.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")
				const currentMode = controller.stateManager.getGlobalSettingsKey("mode")

				if (planActSeparateModelsSetting) {
					// Separate models: update only current mode
					const modelIdField = currentMode === "plan" ? "planModeOpenRouterModelId" : "actModeOpenRouterModelId"
					const modelInfoField = currentMode === "plan" ? "planModeOpenRouterModelInfo" : "actModeOpenRouterModelInfo"
					const modelId = apiConfiguration[modelIdField]

					if (modelId && models[modelId]) {
						controller.stateManager.setGlobalState(modelInfoField, models[modelId])
						await controller.postStateToWebview()
					}
				} else {
					// Shared models: update both plan and act modes
					const planModelId = apiConfiguration.planModeOpenRouterModelId
					const actModelId = apiConfiguration.actModeOpenRouterModelId
					const updates: Partial<GlobalStateAndSettings> = {}

					// Update plan mode model info if we have a model ID
					if (planModelId && models[planModelId]) {
						updates.planModeOpenRouterModelInfo = models[planModelId]
					}

					// Update act mode model info if we have a model ID
					if (actModelId && models[actModelId]) {
						updates.actModeOpenRouterModelInfo = models[actModelId]
					}

					// Post state update if we updated any model info
					if (Object.keys(updates).length > 0) {
						controller.stateManager.setGlobalStateBatch(updates)
						await controller.postStateToWebview()
					}
				}
			}
		})

		refreshGroqModels(controller).then(async (models) => {
			if (models && Object.keys(models).length > 0) {
				// Update model info in state for Groq (this needs to be done here since we don't want to update state while settings is open, and we may refresh models there)
				const apiConfiguration = controller.stateManager.getApiConfiguration()
				const planActSeparateModelsSetting = controller.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")
				const currentMode = controller.stateManager.getGlobalSettingsKey("mode")

				if (planActSeparateModelsSetting) {
					// Separate models: update only current mode
					const modelIdField = currentMode === "plan" ? "planModeGroqModelId" : "actModeGroqModelId"
					const modelInfoField = currentMode === "plan" ? "planModeGroqModelInfo" : "actModeGroqModelInfo"
					const modelId = apiConfiguration[modelIdField]

					if (modelId && models[modelId]) {
						controller.stateManager.setGlobalState(modelInfoField, models[modelId])
						await controller.postStateToWebview()
					}
				} else {
					// Shared models: update both plan and act modes
					const planModelId = apiConfiguration.planModeGroqModelId
					const actModelId = apiConfiguration.actModeGroqModelId
					const updates: Partial<GlobalStateAndSettings> = {}

					// Update plan mode model info if we have a model ID
					if (planModelId && models[planModelId]) {
						updates.planModeGroqModelInfo = models[planModelId]
					}

					// Update act mode model info if we have a model ID
					if (actModelId && models[actModelId]) {
						updates.actModeGroqModelInfo = models[actModelId]
					}

					// Post state update if we updated any model info
					if (Object.keys(updates).length > 0) {
						controller.stateManager.setGlobalStateBatch(updates)
						await controller.postStateToWebview()
					}
				}
			}
		})

		refreshBasetenModels(controller).then(async (models) => {
			if (models && Object.keys(models).length > 0) {
				// Update model info in state for Baseten (this needs to be done here since we don't want to update state while settings is open, and we may refresh models there)
				const apiConfiguration = controller.stateManager.getApiConfiguration()
				const planActSeparateModelsSetting = controller.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")

				const currentMode = controller.stateManager.getGlobalSettingsKey("mode")

				if (planActSeparateModelsSetting) {
					// Separate models: update only current mode
					const modelIdField = currentMode === "plan" ? "planModeBasetenModelId" : "actModeBasetenModelId"
					const modelInfoField = currentMode === "plan" ? "planModeBasetenModelInfo" : "actModeBasetenModelInfo"
					const modelId = apiConfiguration[modelIdField]

					if (modelId && models[modelId]) {
						controller.stateManager.setGlobalState(modelInfoField, models[modelId])
						await controller.postStateToWebview()
					}
				} else {
					// Shared models: update both plan and act modes
					const planModelId = apiConfiguration.planModeBasetenModelId
					const actModelId = apiConfiguration.actModeBasetenModelId

					// Update plan mode model info if we have a model ID
					if (planModelId && models[planModelId]) {
						controller.stateManager.setGlobalState("planModeBasetenModelInfo", models[planModelId])
					}

					// Update act mode model info if we have a model ID
					if (actModelId && models[actModelId]) {
						controller.stateManager.setGlobalState("actModeBasetenModelInfo", models[actModelId])
					}

					// Post state update if we updated any model info
					if ((planModelId && models[planModelId]) || (actModelId && models[actModelId])) {
						await controller.postStateToWebview()
					}
				}
			}
		})

		// Refresh Hicap models from API
		refreshHicapModels(controller, EmptyRequest.create()).then(async (response) => {
			if (response && response.models) {
				// Update model info in state (this needs to be done here since we don't want to update state while settings is open, and we may refresh models there)
				const apiConfiguration = controller.stateManager.getApiConfiguration()
				const planActSeparateModelsSetting = controller.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")
				const currentMode = controller.stateManager.getGlobalSettingsKey("mode")

				if (planActSeparateModelsSetting) {
					// Separate models: update only current mode
					const modelIdField = currentMode === "plan" ? "planModeHicapModelId" : "actModeHicapModelId"
					const modelInfoField = currentMode === "plan" ? "planModeHicapModelInfo" : "actModeHicapModelInfo"
					const modelId = apiConfiguration[modelIdField]

					if (modelId && response.models[modelId]) {
						controller.stateManager.setGlobalState(modelInfoField, response.models[modelId])
						await controller.postStateToWebview()
					}
				} else {
					// Shared models: update both plan and act modes
					const planModelId = apiConfiguration.planModeHicapModelId
					const actModelId = apiConfiguration.actModeHicapModelId
					const updates: Partial<GlobalStateAndSettings> = {}

					// Update plan mode model info if we have a model ID
					if (planModelId && response.models[planModelId]) {
						updates.planModeHicapModelInfo = response.models[planModelId]
					}

					// Update act mode model info if we have a model ID
					if (actModelId && response.models[actModelId]) {
						updates.actModeHicapModelInfo = response.models[actModelId]
					}

					// Post state update if we updated any model info
					if ((planModelId && response.models[planModelId]) || (actModelId && response.models[actModelId])) {
						controller.stateManager.setGlobalStateBatch(updates)
						await controller.postStateToWebview()
					}
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
		// Prefetch marketplace and OpenRouter models

		// Send stored MCP marketplace catalog if available
		const mcpMarketplaceCatalog = await readMcpMarketplaceCatalogFromCache()

		if (mcpMarketplaceCatalog) {
			sendMcpMarketplaceCatalogEvent(mcpMarketplaceCatalog)
		}

		// Silently refresh MCP marketplace catalog
		controller.refreshMcpMarketplace(true /* sendCatalogEvent */)

		// Initialize telemetry service with user's current setting
		controller.getStateToPostToWebview().then((state) => {
			const { telemetrySetting } = state
			const isOptedIn = telemetrySetting !== "disabled"
			telemetryService.updateTelemetryState(isOptedIn)
		})

		return Empty.create({})
	} catch (error) {
		console.error("Failed to initialize webview:", error)
		// Return empty response even on error to not break the frontend
		return Empty.create({})
	}
}

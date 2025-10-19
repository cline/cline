import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { readMcpMarketplaceCatalogFromCache } from "@/core/storage/disk"
import { telemetryService } from "@/services/telemetry"
import { GlobalStateAndSettings } from "@/shared/storage/state-keys"
import type { Controller } from "../index"
import { sendMcpMarketplaceCatalogEvent } from "../mcp/subscribeToMcpMarketplaceCatalog"
import { refreshBasetenModels } from "../models/refreshBasetenModels"
import { refreshGroqModels } from "../models/refreshGroqModels"
import { refreshOpenRouterModels } from "../models/refreshOpenRouterModels"
import { refreshVercelAiGatewayModels } from "../models/refreshVercelAiGatewayModels"
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
		refreshOpenRouterModels(controller, EmptyRequest.create()).then(async (response) => {
			if (response && response.models) {
				// Update model info in state (this needs to be done here since we don't want to update state while settings is open, and we may refresh models there)
				const apiConfiguration = controller.stateManager.getApiConfiguration()
				const planActSeparateModelsSetting = controller.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")
				const currentMode = controller.stateManager.getGlobalSettingsKey("mode")

				if (planActSeparateModelsSetting) {
					// Separate models: update only current mode
					const modelIdField = currentMode === "plan" ? "planModeOpenRouterModelId" : "actModeOpenRouterModelId"
					const modelInfoField = currentMode === "plan" ? "planModeOpenRouterModelInfo" : "actModeOpenRouterModelInfo"
					const modelId = apiConfiguration[modelIdField]

					if (modelId && response.models[modelId]) {
						controller.stateManager.setGlobalState(modelInfoField, response.models[modelId])
						await controller.postStateToWebview()
					}
				} else {
					// Shared models: update both plan and act modes
					const planModelId = apiConfiguration.planModeOpenRouterModelId
					const actModelId = apiConfiguration.actModeOpenRouterModelId
					const updates: Partial<GlobalStateAndSettings> = {}

					// Update plan mode model info if we have a model ID
					if (planModelId && response.models[planModelId]) {
						updates.planModeOpenRouterModelInfo = response.models[planModelId]
					}

					// Update act mode model info if we have a model ID
					if (actModelId && response.models[actModelId]) {
						updates.actModeOpenRouterModelInfo = response.models[actModelId]
					}

					// Post state update if we updated any model info
					if (Object.keys(updates).length > 0) {
						controller.stateManager.setGlobalStateBatch(updates)
						await controller.postStateToWebview()
					}
				}
			}
		})

		refreshGroqModels(controller, EmptyRequest.create()).then(async (response) => {
			if (response && response.models) {
				// Update model info in state for Groq (this needs to be done here since we don't want to update state while settings is open, and we may refresh models there)
				const apiConfiguration = controller.stateManager.getApiConfiguration()
				const planActSeparateModelsSetting = controller.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")
				const currentMode = controller.stateManager.getGlobalSettingsKey("mode")

				if (planActSeparateModelsSetting) {
					// Separate models: update only current mode
					const modelIdField = currentMode === "plan" ? "planModeGroqModelId" : "actModeGroqModelId"
					const modelInfoField = currentMode === "plan" ? "planModeGroqModelInfo" : "actModeGroqModelInfo"
					const modelId = apiConfiguration[modelIdField]

					if (modelId && response.models[modelId]) {
						controller.stateManager.setGlobalState(modelInfoField, response.models[modelId])
						await controller.postStateToWebview()
					}
				} else {
					// Shared models: update both plan and act modes
					const planModelId = apiConfiguration.planModeGroqModelId
					const actModelId = apiConfiguration.actModeGroqModelId
					const updates: Partial<GlobalStateAndSettings> = {}

					// Update plan mode model info if we have a model ID
					if (planModelId && response.models[planModelId]) {
						updates.planModeGroqModelInfo = response.models[planModelId]
					}

					// Update act mode model info if we have a model ID
					if (actModelId && response.models[actModelId]) {
						updates.actModeGroqModelInfo = response.models[actModelId]
					}

					// Post state update if we updated any model info
					if (Object.keys(updates).length > 0) {
						controller.stateManager.setGlobalStateBatch(updates)
						await controller.postStateToWebview()
					}
				}
			}
		})

		refreshBasetenModels(controller, EmptyRequest.create()).then(async (response) => {
			if (response && response.models) {
				// Update model info in state for Baseten (this needs to be done here since we don't want to update state while settings is open, and we may refresh models there)
				const apiConfiguration = controller.stateManager.getApiConfiguration()
				const planActSeparateModelsSetting = controller.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")

				const currentMode = controller.stateManager.getGlobalSettingsKey("mode")

				if (planActSeparateModelsSetting) {
					// Separate models: update only current mode
					const modelIdField = currentMode === "plan" ? "planModeBasetenModelId" : "actModeBasetenModelId"
					const modelInfoField = currentMode === "plan" ? "planModeBasetenModelInfo" : "actModeBasetenModelInfo"
					const modelId = apiConfiguration[modelIdField]

					if (modelId && response.models[modelId]) {
						controller.stateManager.setGlobalState(modelInfoField, response.models[modelId])
						await controller.postStateToWebview()
					}
				} else {
					// Shared models: update both plan and act modes
					const planModelId = apiConfiguration.planModeBasetenModelId
					const actModelId = apiConfiguration.actModeBasetenModelId

					// Update plan mode model info if we have a model ID
					if (planModelId && response.models[planModelId]) {
						controller.stateManager.setGlobalState("planModeBasetenModelInfo", response.models[planModelId])
					}

					// Update act mode model info if we have a model ID
					if (actModelId && response.models[actModelId]) {
						controller.stateManager.setGlobalState("actModeBasetenModelInfo", response.models[actModelId])
					}

					// Post state update if we updated any model info
					if ((planModelId && response.models[planModelId]) || (actModelId && response.models[actModelId])) {
						await controller.postStateToWebview()
					}
				}
			}
		})

		// Refresh Vercel AI Gateway models from API
		refreshVercelAiGatewayModels(controller, EmptyRequest.create()).then(async (response) => {
			if (response && response.models) {
				// Update model info in state for Vercel AI Gateway (this needs to be done here since we don't want to update state while settings is open, and we may refresh models there)
				const apiConfiguration = controller.stateManager.getApiConfiguration()
				const planActSeparateModelsSetting = controller.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")
				const currentMode = controller.stateManager.getGlobalSettingsKey("mode")

				if (planActSeparateModelsSetting) {
					// Separate models: update only current mode
					const modelIdField =
						currentMode === "plan" ? "planModeVercelAiGatewayModelId" : "actModeVercelAiGatewayModelId"
					const modelInfoField =
						currentMode === "plan" ? "planModeVercelAiGatewayModelInfo" : "actModeVercelAiGatewayModelInfo"
					const modelId = apiConfiguration[modelIdField]

					if (modelId && response.models[modelId]) {
						controller.stateManager.setGlobalState(modelInfoField, response.models[modelId])
						await controller.postStateToWebview()
					}
				} else {
					// Shared models: update both plan and act modes
					const planModelId = apiConfiguration.planModeVercelAiGatewayModelId
					const actModelId = apiConfiguration.actModeVercelAiGatewayModelId
					const updates: Partial<GlobalStateAndSettings> = {}

					// Update plan mode model info if we have a model ID
					if (planModelId && response.models[planModelId]) {
						updates.planModeVercelAiGatewayModelInfo = response.models[planModelId]
					}

					// Update act mode model info if we have a model ID
					if (actModelId && response.models[actModelId]) {
						updates.actModeVercelAiGatewayModelInfo = response.models[actModelId]
					}

					// Post state update if we updated any model info
					if (Object.keys(updates).length > 0) {
						controller.stateManager.setGlobalStateBatch(updates)
						await controller.postStateToWebview()
					}
				}
			}
		})

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
		controller.silentlyRefreshMcpMarketplace()

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

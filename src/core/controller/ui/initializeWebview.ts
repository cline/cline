import { McpMarketplaceCatalog } from "@shared/mcp"
import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { telemetryService } from "@/services/telemetry"
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
		// Post last cached models in case the call to endpoint fails
		controller.readOpenRouterModels().then((openRouterModels) => {
			if (openRouterModels) {
				sendOpenRouterModelsEvent(OpenRouterCompatibleModelInfo.create({ models: openRouterModels }))
			}
		})

		// Refresh OpenRouter models from API
		refreshOpenRouterModels(controller, EmptyRequest.create()).then(async (response) => {
			if (response && response.models) {
				// Update model info in state (this needs to be done here since we don't want to update state while settings is open, and we may refresh models there)
				const apiConfiguration = controller.stateManager.getApiConfiguration()
				const planActSeparateModelsSetting = controller.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")
				const currentMode = await controller.getCurrentMode()

				if (planActSeparateModelsSetting) {
					// Separate models: update only current mode
					const modelIdField = currentMode === "plan" ? "planModeOpenRouterModelId" : "actModeOpenRouterModelId"
					const modelInfoField = currentMode === "plan" ? "planModeOpenRouterModelInfo" : "actModeOpenRouterModelInfo"
					const modelId = apiConfiguration[modelIdField]

					if (modelId && response.models[modelId]) {
						const updatedConfig = {
							...apiConfiguration,
							[modelInfoField]: response.models[modelId],
						}
						controller.stateManager.setApiConfiguration(updatedConfig)
						await controller.postStateToWebview()
					}
				} else {
					// Shared models: update both plan and act modes
					const planModelId = apiConfiguration.planModeOpenRouterModelId
					const actModelId = apiConfiguration.actModeOpenRouterModelId
					const updatedConfig = { ...apiConfiguration }

					// Update plan mode model info if we have a model ID
					if (planModelId && response.models[planModelId]) {
						updatedConfig.planModeOpenRouterModelInfo = response.models[planModelId]
					}

					// Update act mode model info if we have a model ID
					if (actModelId && response.models[actModelId]) {
						updatedConfig.actModeOpenRouterModelInfo = response.models[actModelId]
					}

					// Post state update if we updated any model info
					if ((planModelId && response.models[planModelId]) || (actModelId && response.models[actModelId])) {
						controller.stateManager.setApiConfiguration(updatedConfig)
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
				const currentMode = await controller.getCurrentMode()

				if (planActSeparateModelsSetting) {
					// Separate models: update only current mode
					const modelIdField = currentMode === "plan" ? "planModeGroqModelId" : "actModeGroqModelId"
					const modelInfoField = currentMode === "plan" ? "planModeGroqModelInfo" : "actModeGroqModelInfo"
					const modelId = apiConfiguration[modelIdField]

					if (modelId && response.models[modelId]) {
						const updatedConfig = {
							...apiConfiguration,
							[modelInfoField]: response.models[modelId],
						}
						controller.stateManager.setApiConfiguration(updatedConfig)
						await controller.postStateToWebview()
					}
				} else {
					// Shared models: update both plan and act modes
					const planModelId = apiConfiguration.planModeGroqModelId
					const actModelId = apiConfiguration.actModeGroqModelId
					const updatedConfig = { ...apiConfiguration }

					// Update plan mode model info if we have a model ID
					if (planModelId && response.models[planModelId]) {
						updatedConfig.planModeGroqModelInfo = response.models[planModelId]
					}

					// Update act mode model info if we have a model ID
					if (actModelId && response.models[actModelId]) {
						updatedConfig.actModeGroqModelInfo = response.models[actModelId]
					}

					// Post state update if we updated any model info
					if ((planModelId && response.models[planModelId]) || (actModelId && response.models[actModelId])) {
						controller.stateManager.setApiConfiguration(updatedConfig)
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

				const currentMode = await controller.getCurrentMode()

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
				const currentMode = await controller.getCurrentMode()

				if (planActSeparateModelsSetting) {
					// Separate models: update only current mode
					const modelIdField =
						currentMode === "plan" ? "planModeVercelAiGatewayModelId" : "actModeVercelAiGatewayModelId"
					const modelInfoField =
						currentMode === "plan" ? "planModeVercelAiGatewayModelInfo" : "actModeVercelAiGatewayModelInfo"
					const modelId = apiConfiguration[modelIdField]

					if (modelId && response.models[modelId]) {
						const updatedConfig = {
							...apiConfiguration,
							[modelInfoField]: response.models[modelId],
						}
						controller.stateManager.setApiConfiguration(updatedConfig)
						await controller.postStateToWebview()
					}
				} else {
					// Shared models: update both plan and act modes
					const planModelId = apiConfiguration.planModeVercelAiGatewayModelId
					const actModelId = apiConfiguration.actModeVercelAiGatewayModelId
					const updatedConfig = { ...apiConfiguration }

					// Update plan mode model info if we have a model ID
					if (planModelId && response.models[planModelId]) {
						updatedConfig.planModeVercelAiGatewayModelInfo = response.models[planModelId]
					}

					// Update act mode model info if we have a model ID
					if (actModelId && response.models[actModelId]) {
						updatedConfig.actModeVercelAiGatewayModelInfo = response.models[actModelId]
					}

					// Post state update if we updated any model info
					if ((planModelId && response.models[planModelId]) || (actModelId && response.models[actModelId])) {
						controller.stateManager.setApiConfiguration(updatedConfig)
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
		const mcpMarketplaceCatalog = controller.stateManager.getGlobalStateKey("mcpMarketplaceCatalog")

		if (mcpMarketplaceCatalog) {
			sendMcpMarketplaceCatalogEvent(mcpMarketplaceCatalog as McpMarketplaceCatalog)
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

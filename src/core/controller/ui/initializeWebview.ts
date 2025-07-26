import type { Controller } from "../index"
import { EmptyRequest, Empty } from "@shared/proto/cline/common"

import { getAllExtensionState, getGlobalState, updateGlobalState } from "../../storage/state"
import { sendOpenRouterModelsEvent } from "../models/subscribeToOpenRouterModels"
import { sendMcpMarketplaceCatalogEvent } from "../mcp/subscribeToMcpMarketplaceCatalog"
import { telemetryService } from "@/services/posthog/telemetry/TelemetryService"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { McpMarketplaceCatalog } from "@shared/mcp"
import { refreshOpenRouterModels } from "../models/refreshOpenRouterModels"
import { refreshGroqModels } from "../models/refreshGroqModels"

/**
 * Initialize webview when it launches
 * @param controller The controller instance
 * @param request The empty request
 * @returns Empty response
 */
export async function initializeWebview(controller: Controller, request: EmptyRequest): Promise<Empty> {
	try {
		// Populate file paths for workspace tracker (don't await)
		controller.workspaceTracker?.populateFilePaths()

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
				const { apiConfiguration, planActSeparateModelsSetting } = await getAllExtensionState(controller.context)
				const currentMode = await controller.getCurrentMode()

				if (planActSeparateModelsSetting) {
					// Separate models: update only current mode
					const modelIdField = currentMode === "plan" ? "planModeOpenRouterModelId" : "actModeOpenRouterModelId"
					const modelInfoField = currentMode === "plan" ? "planModeOpenRouterModelInfo" : "actModeOpenRouterModelInfo"
					const modelId = apiConfiguration[modelIdField]

					if (modelId && response.models[modelId]) {
						await updateGlobalState(controller.context, modelInfoField, response.models[modelId])
						await controller.postStateToWebview()
					}
				} else {
					// Shared models: update both plan and act modes
					const planModelId = apiConfiguration.planModeOpenRouterModelId
					const actModelId = apiConfiguration.actModeOpenRouterModelId

					// Update plan mode model info if we have a model ID
					if (planModelId && response.models[planModelId]) {
						await updateGlobalState(controller.context, "planModeOpenRouterModelInfo", response.models[planModelId])
					}

					// Update act mode model info if we have a model ID
					if (actModelId && response.models[actModelId]) {
						await updateGlobalState(controller.context, "actModeOpenRouterModelInfo", response.models[actModelId])
					}

					// Post state update if we updated any model info
					if ((planModelId && response.models[planModelId]) || (actModelId && response.models[actModelId])) {
						await controller.postStateToWebview()
					}
				}
			}
		})

		refreshGroqModels(controller, EmptyRequest.create()).then(async (response) => {
			if (response && response.models) {
				// Update model info in state for Groq (this needs to be done here since we don't want to update state while settings is open, and we may refresh models there)
				const { apiConfiguration, planActSeparateModelsSetting } = await getAllExtensionState(controller.context)
				const currentMode = await controller.getCurrentMode()

				if (planActSeparateModelsSetting) {
					// Separate models: update only current mode
					const modelIdField = currentMode === "plan" ? "planModeGroqModelId" : "actModeGroqModelId"
					const modelInfoField = currentMode === "plan" ? "planModeGroqModelInfo" : "actModeGroqModelInfo"
					const modelId = apiConfiguration[modelIdField]

					if (modelId && response.models[modelId]) {
						await updateGlobalState(controller.context, modelInfoField, response.models[modelId])
						await controller.postStateToWebview()
					}
				} else {
					// Shared models: update both plan and act modes
					const planModelId = apiConfiguration.planModeGroqModelId
					const actModelId = apiConfiguration.actModeGroqModelId

					// Update plan mode model info if we have a model ID
					if (planModelId && response.models[planModelId]) {
						await updateGlobalState(controller.context, "planModeGroqModelInfo", response.models[planModelId])
					}

					// Update act mode model info if we have a model ID
					if (actModelId && response.models[actModelId]) {
						await updateGlobalState(controller.context, "actModeGroqModelInfo", response.models[actModelId])
					}

					// Post state update if we updated any model info
					if ((planModelId && response.models[planModelId]) || (actModelId && response.models[actModelId])) {
						await controller.postStateToWebview()
					}
				}
			}
		})

		// GUI relies on model info to be up-to-date to provide the most accurate pricing, so we need to fetch the latest details on launch.
		// We do this for all users since many users switch between api providers and if they were to switch back to openrouter it would be showing outdated model info if we hadn't retrieved the latest at this point
		// (see normalizeApiConfiguration > openrouter)
		// Prefetch marketplace and OpenRouter models

		// Send cached MCP marketplace catalog if available
		getGlobalState(controller.context, "mcpMarketplaceCatalog").then((mcpMarketplaceCatalog) => {
			if (mcpMarketplaceCatalog) {
				sendMcpMarketplaceCatalogEvent(mcpMarketplaceCatalog as McpMarketplaceCatalog)
			}
		})

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

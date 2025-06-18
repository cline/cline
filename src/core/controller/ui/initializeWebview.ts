import type { Controller } from "../index"
import { EmptyRequest, Empty } from "@shared/proto/common"
import { handleModelsServiceRequest } from "../models"
import { getAllExtensionState, getGlobalState, updateWorkspaceState } from "../../storage/state"
import { sendOpenRouterModelsEvent } from "../models/subscribeToOpenRouterModels"
import { sendMcpMarketplaceCatalogEvent } from "../mcp/subscribeToMcpMarketplaceCatalog"
import { telemetryService } from "@/services/posthog/telemetry/TelemetryService"
import { OpenRouterCompatibleModelInfo } from "@/shared/proto/models"
import { McpMarketplaceCatalog } from "@shared/mcp"

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
		handleModelsServiceRequest(controller, "refreshOpenRouterModels", EmptyRequest.create()).then(async (response) => {
			if (response && response.models) {
				// Update model info in state (this needs to be done here since we don't want to update state while settings is open, and we may refresh models there)
				const { apiConfiguration } = await getAllExtensionState(controller.context)
				if (apiConfiguration.openRouterModelId && response.models[apiConfiguration.openRouterModelId]) {
					await updateWorkspaceState(
						controller.context,
						"openRouterModelInfo",
						response.models[apiConfiguration.openRouterModelId],
					)
					await controller.postStateToWebview()
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

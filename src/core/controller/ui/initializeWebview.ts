import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { readMcpMarketplaceCatalogFromCache } from "@/core/storage/disk"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import { DEFAULT_API_PROVIDER } from "@/shared/api"
import { GlobalStateAndSettings } from "@/shared/storage/state-keys"
import type { Controller } from "../index"
import { sendMcpMarketplaceCatalogEvent } from "../mcp/subscribeToMcpMarketplaceCatalog"
import { refreshBasetenModels } from "../models/refreshBasetenModels"
import { refreshClineModels } from "../models/refreshClineModels"
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
				const currentMode = controller.stateManager.getGlobalSettingsKey("mode")

				const modelIdField = currentMode === "plan" ? "planConfig" : "actConfig"
				const modelId = apiConfiguration[modelIdField]?.modelId

				if (modelId && models[modelId]) {
					const updates: Partial<GlobalStateAndSettings> = {}
					updates[modelIdField] = {
						...apiConfiguration[modelIdField],
						apiProvider: apiConfiguration[modelIdField]?.apiProvider ?? DEFAULT_API_PROVIDER,
						modelInfo: models[modelId],
					}
					controller.stateManager.setGlobalStateBatch(updates)
					await controller.postStateToWebview()
				}
			}
		})

		refreshClineModels(controller).then(async (models) => {
			if (models && Object.keys(models).length > 0) {
				// Update model info in state for Cline (this needs to be done here since we don't want to update state while settings is open, and we may refresh models there)
				const apiConfiguration = controller.stateManager.getApiConfiguration()
				const currentMode = controller.stateManager.getGlobalSettingsKey("mode")

				const modelIdField = currentMode === "plan" ? "planConfig" : "actConfig"
				const modelId = apiConfiguration[modelIdField]?.modelId

				if (modelId && models[modelId]) {
					const updates: Partial<GlobalStateAndSettings> = {}
					updates[modelIdField] = {
						...apiConfiguration[modelIdField],
						apiProvider: apiConfiguration[modelIdField]?.apiProvider ?? DEFAULT_API_PROVIDER,
						modelInfo: models[modelId],
					}
					controller.stateManager.setGlobalStateBatch(updates)
					await controller.postStateToWebview()
				}
			}
		})

		refreshGroqModels(controller).then(async (models) => {
			if (models && Object.keys(models).length > 0) {
				// Update model info in state for Groq (this needs to be done here since we don't want to update state while settings is open, and we may refresh models there)
				const apiConfiguration = controller.stateManager.getApiConfiguration()
				const currentMode = controller.stateManager.getGlobalSettingsKey("mode")

				const modelIdField = currentMode === "plan" ? "planConfig" : "actConfig"
				const modelId = apiConfiguration[modelIdField]?.modelId

				if (modelId && models[modelId]) {
					const updates: Partial<GlobalStateAndSettings> = {}
					updates[modelIdField] = {
						...apiConfiguration[modelIdField],
						apiProvider: apiConfiguration[modelIdField]?.apiProvider ?? DEFAULT_API_PROVIDER,
						modelInfo: models[modelId],
					}
					controller.stateManager.setGlobalStateBatch(updates)
					await controller.postStateToWebview()
				}
			}
		})

		refreshBasetenModels(controller).then(async (models) => {
			if (models && Object.keys(models).length > 0) {
				// Update model info in state for Baseten (this needs to be done here since we don't want to update state while settings is open, and we may refresh models there)
				const apiConfiguration = controller.stateManager.getApiConfiguration()
				const currentMode = controller.stateManager.getGlobalSettingsKey("mode")

				const modelIdField = currentMode === "plan" ? "planConfig" : "actConfig"
				const modelId = apiConfiguration[modelIdField]?.modelId

				if (modelId && models[modelId]) {
					const updates: Partial<GlobalStateAndSettings> = {}
					updates[modelIdField] = {
						...apiConfiguration[modelIdField],
						apiProvider: apiConfiguration[modelIdField]?.apiProvider ?? DEFAULT_API_PROVIDER,
						modelInfo: models[modelId],
					}
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
				const currentMode = controller.stateManager.getGlobalSettingsKey("mode")

				const modelIdField = currentMode === "plan" ? "planConfig" : "actConfig"
				const modelId = apiConfiguration[modelIdField]?.modelId

				if (modelId && response.models[modelId]) {
					const updates: Partial<GlobalStateAndSettings> = {}
					updates[modelIdField] = {
						...apiConfiguration[modelIdField],
						apiProvider: apiConfiguration[modelIdField]?.apiProvider ?? DEFAULT_API_PROVIDER,
						modelInfo: response.models[modelId],
					}
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
		Logger.error("Failed to initialize webview:", error)
		// Return empty response even on error to not break the frontend
		return Empty.create({})
	}
}

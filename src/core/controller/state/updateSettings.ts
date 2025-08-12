import { Controller } from ".."
import { Empty } from "@shared/proto/cline/common"
import {
	PlanActMode,
	UpdateSettingsRequest,
	OpenaiReasoningEffort as ProtoOpenaiReasoningEffort,
	McpDisplayMode as ProtoMcpDisplayMode,
} from "@shared/proto/cline/state"
import { buildApiHandler } from "../../../api"
import { convertProtoApiConfigurationToApiConfiguration } from "../../../shared/proto-conversions/state/settings-conversion"
import { TelemetrySetting } from "@/shared/TelemetrySetting"
import { OpenaiReasoningEffort } from "@/shared/storage/types"
import { McpDisplayMode } from "@/shared/McpDisplayMode"
import { telemetryService } from "../../../services/posthog/PostHogClientProvider"
import { FocusChainSettings } from "@shared/FocusChainSettings"

/**
 * Updates multiple extension settings in a single request
 * @param controller The controller instance
 * @param request The request containing the settings to update
 * @returns An empty response
 */
export async function updateSettings(controller: Controller, request: UpdateSettingsRequest): Promise<Empty> {
	try {
		// Update API configuration
		if (request.apiConfiguration) {
			const apiConfiguration = convertProtoApiConfigurationToApiConfiguration(request.apiConfiguration)
			controller.cacheService.setApiConfiguration(apiConfiguration)

			if (controller.task) {
				const currentMode = await controller.getCurrentMode()
				controller.task.api = buildApiHandler({ ...apiConfiguration, ulid: controller.task.ulid }, currentMode)
			}
		}

		// Update telemetry setting
		if (request.telemetrySetting) {
			await controller.updateTelemetrySetting(request.telemetrySetting as TelemetrySetting)
		}

		// Update plan/act separate models setting
		if (request.planActSeparateModelsSetting !== undefined) {
			controller.cacheService.setGlobalState("planActSeparateModelsSetting", request.planActSeparateModelsSetting)
		}

		// Update checkpoints setting
		if (request.enableCheckpointsSetting !== undefined) {
			controller.cacheService.setGlobalState("enableCheckpointsSetting", request.enableCheckpointsSetting)
		}

		// Update MCP marketplace setting
		if (request.mcpMarketplaceEnabled !== undefined) {
			controller.cacheService.setGlobalState("mcpMarketplaceEnabled", request.mcpMarketplaceEnabled)
		}

		// Update MCP responses collapsed setting
		if (request.mcpResponsesCollapsed !== undefined) {
			controller.cacheService.setGlobalState("mcpResponsesCollapsed", request.mcpResponsesCollapsed)
		}

		// Update MCP display mode setting
		if (request.mcpDisplayMode !== undefined) {
			// Convert proto enum to string type
			let displayMode: McpDisplayMode
			switch (request.mcpDisplayMode) {
				case ProtoMcpDisplayMode.RICH:
					displayMode = "rich"
					break
				case ProtoMcpDisplayMode.PLAIN:
					displayMode = "plain"
					break
				case ProtoMcpDisplayMode.MARKDOWN:
					displayMode = "markdown"
					break
				default:
					throw new Error(`Invalid MCP display mode value: ${request.mcpDisplayMode}`)
			}
			controller.cacheService.setGlobalState("mcpDisplayMode", displayMode)
		}

		if (request.mode !== undefined) {
			const mode = request.mode === PlanActMode.PLAN ? "plan" : "act"
			if (controller.task) {
				controller.task.updateMode(mode)
			}
			controller.cacheService.setGlobalState("mode", mode)
		}

		if (request.openaiReasoningEffort !== undefined) {
			// Convert proto enum to string type
			let reasoningEffort: OpenaiReasoningEffort
			switch (request.openaiReasoningEffort) {
				case ProtoOpenaiReasoningEffort.LOW:
					reasoningEffort = "low"
					break
				case ProtoOpenaiReasoningEffort.MEDIUM:
					reasoningEffort = "medium"
					break
				case ProtoOpenaiReasoningEffort.HIGH:
					reasoningEffort = "high"
					break
				default:
					throw new Error(`Invalid OpenAI reasoning effort value: ${request.openaiReasoningEffort}`)
			}

			if (controller.task) {
				controller.task.openaiReasoningEffort = reasoningEffort
			}

			controller.cacheService.setGlobalState("openaiReasoningEffort", reasoningEffort)
		}

		if (request.preferredLanguage !== undefined) {
			if (controller.task) {
				controller.task.preferredLanguage = request.preferredLanguage
			}
			controller.cacheService.setGlobalState("preferredLanguage", request.preferredLanguage)
		}

		// Update terminal timeout setting
		if (request.shellIntegrationTimeout !== undefined) {
			controller.cacheService.setGlobalState("shellIntegrationTimeout", Number(request.shellIntegrationTimeout))
		}

		// Update terminal reuse setting
		if (request.terminalReuseEnabled !== undefined) {
			controller.cacheService.setGlobalState("terminalReuseEnabled", request.terminalReuseEnabled)
		}

		// Update terminal output line limit
		if (request.terminalOutputLineLimit !== undefined) {
			controller.cacheService.setGlobalState("terminalOutputLineLimit", Number(request.terminalOutputLineLimit))
		}

		// Update strict plan mode setting
		if (request.strictPlanModeEnabled !== undefined) {
			if (controller.task) {
				controller.task.updateStrictPlanMode(request.strictPlanModeEnabled)
			}
			controller.cacheService.setGlobalState("strictPlanModeEnabled", request.strictPlanModeEnabled)
		}

		// Update focus chain settings
		if (request.focusChainSettings !== undefined) {
			const remoteEnabled = controller.cacheService.getGlobalStateKey("focusChainFeatureFlagEnabled")
			if (remoteEnabled === false) {
				// No-op when feature flag disabled
			} else {
				const currentSettings = controller.cacheService.getGlobalStateKey("focusChainSettings")
				const wasEnabled = currentSettings?.enabled ?? false
				const isEnabled = request.focusChainSettings.enabled

				const focusChainSettings = {
					enabled: isEnabled,
					remindClineInterval: request.focusChainSettings.remindClineInterval,
				}
				controller.cacheService.setGlobalState("focusChainSettings", focusChainSettings)

				// Capture telemetry when setting changes
				if (wasEnabled !== isEnabled) {
					telemetryService.captureFocusChainToggle(isEnabled)
				}
			}
		}

		// Post updated state to webview
		await controller.postStateToWebview()

		return Empty.create()
	} catch (error) {
		console.error("Failed to update settings:", error)
		throw error
	}
}

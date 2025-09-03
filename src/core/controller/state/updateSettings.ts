import { buildApiHandler } from "@core/api"
import { Empty } from "@shared/proto/cline/common"
import {
	PlanActMode,
	McpDisplayMode as ProtoMcpDisplayMode,
	OpenaiReasoningEffort as ProtoOpenaiReasoningEffort,
	UpdateSettingsRequest,
} from "@shared/proto/cline/state"
import { convertProtoApiConfigurationToApiConfiguration } from "@shared/proto-conversions/state/settings-conversion"
import { OpenaiReasoningEffort } from "@shared/storage/types"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import { McpDisplayMode } from "@/shared/McpDisplayMode"
import { telemetryService } from "../../../services/telemetry"
import { BrowserSettings as SharedBrowserSettings } from "../../../shared/BrowserSettings"
import { Controller } from ".."

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
			controller.stateManager.setApiConfiguration(apiConfiguration)

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
			controller.stateManager.setGlobalState("planActSeparateModelsSetting", request.planActSeparateModelsSetting)
		}

		// Update checkpoints setting
		if (request.enableCheckpointsSetting !== undefined) {
			controller.stateManager.setGlobalState("enableCheckpointsSetting", request.enableCheckpointsSetting)
		}

		// Update MCP marketplace setting
		if (request.mcpMarketplaceEnabled !== undefined) {
			controller.stateManager.setGlobalState("mcpMarketplaceEnabled", request.mcpMarketplaceEnabled)
		}

		// Update MCP responses collapsed setting
		if (request.mcpResponsesCollapsed !== undefined) {
			controller.stateManager.setGlobalState("mcpResponsesCollapsed", request.mcpResponsesCollapsed)
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
			controller.stateManager.setGlobalState("mcpDisplayMode", displayMode)
		}

		if (request.mode !== undefined) {
			const mode = request.mode === PlanActMode.PLAN ? "plan" : "act"
			if (controller.task) {
				controller.task.updateMode(mode)
			}
			controller.stateManager.setGlobalState("mode", mode)
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

			controller.stateManager.setGlobalState("openaiReasoningEffort", reasoningEffort)
		}

		if (request.preferredLanguage !== undefined) {
			if (controller.task) {
				controller.task.preferredLanguage = request.preferredLanguage
			}
			controller.stateManager.setGlobalState("preferredLanguage", request.preferredLanguage)
		}

		// Update terminal timeout setting
		if (request.shellIntegrationTimeout !== undefined) {
			controller.stateManager.setGlobalState("shellIntegrationTimeout", Number(request.shellIntegrationTimeout))
		}

		// Update terminal reuse setting
		if (request.terminalReuseEnabled !== undefined) {
			controller.stateManager.setGlobalState("terminalReuseEnabled", request.terminalReuseEnabled)
		}

		// Update terminal output line limit
		if (request.terminalOutputLineLimit !== undefined) {
			controller.stateManager.setGlobalState("terminalOutputLineLimit", Number(request.terminalOutputLineLimit))
		}

		// Update strict plan mode setting
		if (request.strictPlanModeEnabled !== undefined) {
			if (controller.task) {
				controller.task.updateStrictPlanMode(request.strictPlanModeEnabled)
			}
			controller.stateManager.setGlobalState("strictPlanModeEnabled", request.strictPlanModeEnabled)
		}

		// Update auto-condense setting
		if (request.useAutoCondense !== undefined) {
			if (controller.task) {
				controller.task.updateUseAutoCondense(request.useAutoCondense)
			}
			controller.stateManager.setGlobalState("useAutoCondense", request.useAutoCondense)
		}

		// Update focus chain settings
		if (request.focusChainSettings !== undefined) {
			const remoteEnabled = controller.stateManager.getGlobalStateKey("focusChainFeatureFlagEnabled")
			if (remoteEnabled === false) {
				// No-op when feature flag disabled
			} else {
				const currentSettings = controller.stateManager.getGlobalStateKey("focusChainSettings")
				const wasEnabled = currentSettings?.enabled ?? false
				const isEnabled = request.focusChainSettings.enabled

				const focusChainSettings = {
					enabled: isEnabled,
					remindClineInterval: request.focusChainSettings.remindClineInterval,
				}
				controller.stateManager.setGlobalState("focusChainSettings", focusChainSettings)

				// Capture telemetry when setting changes
				if (wasEnabled !== isEnabled) {
					telemetryService.captureFocusChainToggle(isEnabled)
				}
			}
		}

		// Update custom prompt choice
		if (request.customPrompt !== undefined) {
			const value = request.customPrompt === "compact" ? "compact" : undefined
			controller.stateManager.setGlobalState("customPrompt", value)
		}

		// Update browser settings
		if (request.browserSettings !== undefined) {
			// Get current browser settings to preserve fields not in the request
			const currentSettings = controller.stateManager.getGlobalStateKey("browserSettings")

			// Convert from protobuf format to shared format, merging with existing settings
			const newBrowserSettings: SharedBrowserSettings = {
				...currentSettings, // Start with existing settings (and defaults)
				viewport: {
					// Apply updates from request
					width: request.browserSettings.viewport?.width || currentSettings.viewport.width,
					height: request.browserSettings.viewport?.height || currentSettings.viewport.height,
				},
				// Explicitly handle optional boolean and string fields from the request
				remoteBrowserEnabled:
					request.browserSettings.remoteBrowserEnabled === undefined
						? currentSettings.remoteBrowserEnabled
						: request.browserSettings.remoteBrowserEnabled,
				remoteBrowserHost:
					request.browserSettings.remoteBrowserHost === undefined
						? currentSettings.remoteBrowserHost
						: request.browserSettings.remoteBrowserHost,
				chromeExecutablePath:
					// If chromeExecutablePath is explicitly in the request (even as ""), use it.
					// Otherwise, fall back to mergedWithDefaults.
					"chromeExecutablePath" in request.browserSettings
						? request.browserSettings.chromeExecutablePath
						: currentSettings.chromeExecutablePath,
				disableToolUse:
					request.browserSettings.disableToolUse === undefined
						? currentSettings.disableToolUse
						: request.browserSettings.disableToolUse,
				customArgs:
					"customArgs" in request.browserSettings ? request.browserSettings.customArgs : currentSettings.customArgs,
			}

			// Update global state with new settings
			controller.stateManager.setGlobalState("browserSettings", newBrowserSettings)

			// Update task browser settings if task exists
			if (controller.task) {
				controller.task.browserSettings = newBrowserSettings
				controller.task.browserSession.browserSettings = newBrowserSettings
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

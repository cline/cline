import { buildApiHandler } from "@core/api"

import { Empty } from "@shared/proto/cline/common"
import {
	PlanActMode,
	OpenaiReasoningEffort as ProtoOpenaiReasoningEffort,
	UpdateSettingsRequestCli,
} from "@shared/proto/cline/state"
import { convertProtoToApiProvider } from "@shared/proto-conversions/models/api-configuration-conversion"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import { Settings } from "@/core/storage/state-keys"
import { HostProvider } from "@/hosts/host-provider"
import { TerminalInfo } from "@/integrations/terminal/TerminalRegistry"
import { ShowMessageType } from "@/shared/proto/host/window"
import { convertProtoToAutoApprovalSettings } from "@/shared/proto-conversions/models/auto-approval-settings-conversion"
import { Mode, OpenaiReasoningEffort } from "@/shared/storage/types"
import { telemetryService } from "../../../services/telemetry"
import { Controller } from ".."

/**
 * Updates multiple extension settings in a single request
 * @param controller The controller instance
 * @param request The request containing the settings to update
 * @returns An empty response
 */
export async function updateSettingsCli(controller: Controller, request: UpdateSettingsRequestCli): Promise<Empty> {
	const convertOpenaiReasoningEffort = (effort: ProtoOpenaiReasoningEffort): OpenaiReasoningEffort => {
		switch (effort) {
			case ProtoOpenaiReasoningEffort.LOW:
				return "low"
			case ProtoOpenaiReasoningEffort.MEDIUM:
				return "medium"
			case ProtoOpenaiReasoningEffort.HIGH:
				return "high"
			case ProtoOpenaiReasoningEffort.MINIMAL:
				return "minimal"
			default:
				return "medium"
		}
	}

	const convertPlanActMode = (mode: PlanActMode): Mode => {
		return mode === PlanActMode.PLAN ? "plan" : "act"
	}

	try {
		if (request.settings) {
			// Extract all special case fields that need dedicated handlers
			// These should NOT be included in the batch update
			const {
				// Fields requiring conversion
				autoApprovalSettings,
				openaiReasoningEffort,
				mode,
				customPrompt,
				planModeApiProvider,
				actModeApiProvider,
				// Fields requiring special logic (telemetry, merging, etc.)
				telemetrySetting,
				yoloModeToggled,
				useAutoCondense,
				focusChainSettings,
				browserSettings,
				defaultTerminalProfile,
				...simpleSettings
			} = request.settings

			// Batch update for simple pass-through fields
			const filteredSettings: Partial<Settings> = Object.fromEntries(
				Object.entries(simpleSettings).filter(([_, value]) => value !== undefined),
			)

			controller.stateManager.setGlobalStateBatch(filteredSettings)

			// Handle fields requiring type conversion from generated protobuf types to application types
			if (autoApprovalSettings) {
				const converted = convertProtoToAutoApprovalSettings({
					...autoApprovalSettings,
					metadata: {},
				})
				controller.stateManager.setGlobalState("autoApprovalSettings", converted)
			}

			if (openaiReasoningEffort !== undefined) {
				const converted = convertOpenaiReasoningEffort(openaiReasoningEffort)
				controller.stateManager.setGlobalState("openaiReasoningEffort", converted)
			}

			if (mode !== undefined) {
				const converted = convertPlanActMode(mode)
				controller.stateManager.setGlobalState("mode", converted)
			}

			if (customPrompt === "compact") {
				controller.stateManager.setGlobalState("customPrompt", "compact")
			}

			if (planModeApiProvider !== undefined) {
				const converted = convertProtoToApiProvider(planModeApiProvider)
				controller.stateManager.setGlobalState("planModeApiProvider", converted)
			}

			if (actModeApiProvider !== undefined) {
				const converted = convertProtoToApiProvider(actModeApiProvider)
				controller.stateManager.setGlobalState("actModeApiProvider", converted)
			}

			if (controller.task) {
				const currentMode = controller.stateManager.getGlobalSettingsKey("mode")
				const apiConfigForHandler = {
					...controller.stateManager.getApiConfiguration(),
					ulid: controller.task.ulid,
				}
				controller.task.api = buildApiHandler(apiConfigForHandler, currentMode)
			}

			// Update telemetry setting
			if (telemetrySetting) {
				await controller.updateTelemetrySetting(telemetrySetting as TelemetrySetting)
			}

			// Update yolo mode setting (requires telemetry)
			if (yoloModeToggled !== undefined) {
				if (controller.task) {
					telemetryService.captureYoloModeToggle(controller.task.ulid, yoloModeToggled)
				}
				controller.stateManager.setGlobalState("yoloModeToggled", yoloModeToggled)
			}

			// Update auto-condense setting (requires telemetry)
			if (useAutoCondense !== undefined) {
				if (controller.task) {
					telemetryService.captureAutoCondenseToggle(
						controller.task.ulid,
						useAutoCondense,
						controller.task.api.getModel().id,
					)
				}
				controller.stateManager.setGlobalState("useAutoCondense", useAutoCondense)
			}

			// Update focus chain settings (requires telemetry on state change)
			if (focusChainSettings !== undefined) {
				const currentSettings = controller.stateManager.getGlobalSettingsKey("focusChainSettings")
				const wasEnabled = currentSettings?.enabled ?? false
				const isEnabled = focusChainSettings.enabled

				const newFocusChainSettings = {
					enabled: isEnabled,
					remindClineInterval: focusChainSettings.remindClineInterval,
				}
				controller.stateManager.setGlobalState("focusChainSettings", newFocusChainSettings)

				// Capture telemetry when setting changes
				if (wasEnabled !== isEnabled) {
					telemetryService.captureFocusChainToggle(isEnabled)
				}
			}

			// Update browser settings (requires careful merging to avoid protobuf defaults)
			if (browserSettings !== undefined) {
				const currentSettings = controller.stateManager.getGlobalSettingsKey("browserSettings")

				const newBrowserSettings = {
					...currentSettings,
					viewport: {
						width: browserSettings.viewport?.width || currentSettings.viewport.width,
						height: browserSettings.viewport?.height || currentSettings.viewport.height,
					},
					...(browserSettings.remoteBrowserEnabled !== undefined && {
						remoteBrowserEnabled: browserSettings.remoteBrowserEnabled,
					}),
					...(browserSettings.remoteBrowserHost !== undefined && {
						remoteBrowserHost: browserSettings.remoteBrowserHost,
					}),
					...(browserSettings.chromeExecutablePath !== undefined && {
						chromeExecutablePath: browserSettings.chromeExecutablePath,
					}),
					...(browserSettings.disableToolUse !== undefined && {
						disableToolUse: browserSettings.disableToolUse,
					}),
					...(browserSettings.customArgs !== undefined && {
						customArgs: browserSettings.customArgs,
					}),
				}

				controller.stateManager.setGlobalState("browserSettings", newBrowserSettings)
			}

			// Update default terminal profile (requires terminal manager updates and notifications)
			if (defaultTerminalProfile !== undefined) {
				const profileId = defaultTerminalProfile

				// Update the terminal profile in the state
				controller.stateManager.setGlobalState("defaultTerminalProfile", profileId)

				let closedCount = 0
				let busyTerminals: TerminalInfo[] = []

				// Update the terminal manager of the current task if it exists
				if (controller.task) {
					// Call the updated setDefaultTerminalProfile method that returns closed terminal info
					const result = controller.task.terminalManager.setDefaultTerminalProfile(profileId)
					closedCount = result.closedCount
					busyTerminals = result.busyTerminals

					// Show information message if terminals were closed
					if (closedCount > 0) {
						const message = `Closed ${closedCount} ${closedCount === 1 ? "terminal" : "terminals"} with different profile.`
						HostProvider.window.showMessage({
							type: ShowMessageType.INFORMATION,
							message,
						})
					}

					// Show warning if there are busy terminals that couldn't be closed
					if (busyTerminals.length > 0) {
						const message =
							`${busyTerminals.length} busy ${busyTerminals.length === 1 ? "terminal has" : "terminals have"} a different profile. ` +
							`Close ${busyTerminals.length === 1 ? "it" : "them"} to use the new profile for all commands.`
						HostProvider.window.showMessage({
							type: ShowMessageType.WARNING,
							message,
						})
					}
				}
			}
		}

		// Handle secrets update
		if (request.secrets) {
			const filteredSecrets = Object.fromEntries(
				Object.entries(request.secrets).filter(([_, value]) => value !== undefined),
			)

			controller.stateManager.setSecretsBatch(filteredSecrets)
		}

		// Post updated state to webview
		await controller.postStateToWebview()

		return Empty.create()
	} catch (error) {
		console.error("Failed to update settings:", error)
		throw error
	}
}

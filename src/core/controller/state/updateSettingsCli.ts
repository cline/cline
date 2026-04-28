import { buildApiHandler } from "@core/api"

import { Empty } from "@shared/proto/cline/common"
import { PlanActMode, UpdateSettingsRequestCli } from "@shared/proto/cline/state"
import { convertProtoToApiProvider } from "@shared/proto-conversions/models/api-configuration-conversion"
import { Settings } from "@shared/storage/state-keys"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import { ClineEnv } from "@/config"
import { Logger } from "@/shared/services/Logger"
import { Mode } from "@/shared/storage/types"
import { telemetryService } from "../../../services/telemetry"
import { Controller } from ".."
import { accountLogoutClicked } from "../account/accountLogoutClicked"
import { normalizeOpenaiReasoningEffort } from "./reasoningEffort"

/**
 * Updates multiple extension settings in a single request
 * @param controller The controller instance
 * @param request The request containing the settings to update
 * @returns An empty response
 */
export async function updateSettingsCli(controller: Controller, request: UpdateSettingsRequestCli): Promise<Empty> {
	const convertPlanActMode = (mode: PlanActMode): Mode => {
		return mode === PlanActMode.PLAN ? "plan" : "act"
	}

	try {
		if (request.environment !== undefined) {
			ClineEnv.setEnvironment(request.environment)
			await accountLogoutClicked(controller, Empty.create())
		}

		if (request.settings) {
			// Extract all special case fields that need dedicated handlers
			// These should NOT be included in the batch update
			const {
				// Fields requiring conversion
				autoApprovalSettings,
				planModeReasoningEffort,
				actModeReasoningEffort,
				mode,
				customPrompt,
				planModeApiProvider,
				actModeApiProvider,
				// Fields requiring special logic (telemetry, merging, etc.)
				telemetrySetting,
				yoloModeToggled,
				useAutoCondense,
				clineWebToolsEnabled,
				worktreesEnabled,
				subagentsEnabled,
				focusChainSettings,
				browserSettings,
				...simpleSettings
			} = request.settings

			// Batch update for simple pass-through fields
			const filteredSettings: Partial<Settings> = Object.fromEntries(
				Object.entries(simpleSettings).filter(([key, value]) => key !== "openaiReasoningEffort" && value !== undefined),
			)

			controller.stateManager.setGlobalStateBatch(filteredSettings)

			Logger.log("autoApprovalSettings", controller.stateManager.getGlobalSettingsKey("autoApprovalSettings"))

			// Handle fields requiring type conversion from generated protobuf types to application types
			if (autoApprovalSettings) {
				// Merge with current settings to preserve unspecified fields
				const currentAutoApprovalSettings = controller.stateManager.getGlobalSettingsKey("autoApprovalSettings")
				const mergedSettings = {
					...currentAutoApprovalSettings,
					...(autoApprovalSettings.version !== undefined && { version: autoApprovalSettings.version }),
					...(autoApprovalSettings.enableNotifications !== undefined && {
						enableNotifications: autoApprovalSettings.enableNotifications,
					}),
					actions: {
						...currentAutoApprovalSettings.actions,
						...(autoApprovalSettings.actions
							? Object.fromEntries(Object.entries(autoApprovalSettings.actions).filter(([_, v]) => v !== undefined))
							: {}),
					},
				}

				controller.stateManager.setGlobalState("autoApprovalSettings", mergedSettings)
			}

			if (planModeReasoningEffort !== undefined) {
				const converted = normalizeOpenaiReasoningEffort(planModeReasoningEffort)
				controller.stateManager.setGlobalState("planModeReasoningEffort", converted)
			}

			if (actModeReasoningEffort !== undefined) {
				const converted = normalizeOpenaiReasoningEffort(actModeReasoningEffort)
				controller.stateManager.setGlobalState("actModeReasoningEffort", converted)
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

			// Update Cline web tools setting (requires telemetry)
			if (clineWebToolsEnabled !== undefined) {
				if (controller.task) {
					telemetryService.captureClineWebToolsToggle(controller.task.ulid, clineWebToolsEnabled)
				}
				controller.stateManager.setGlobalState("clineWebToolsEnabled", clineWebToolsEnabled)
			}

			// Update worktrees setting
			if (worktreesEnabled !== undefined) {
				controller.stateManager.setGlobalState("worktreesEnabled", worktreesEnabled)
			}

			// Update subagents setting (requires telemetry on state change)
			if (subagentsEnabled !== undefined) {
				const wasEnabled = controller.stateManager.getGlobalSettingsKey("subagentsEnabled") ?? false
				const isEnabled = !!subagentsEnabled
				controller.stateManager.setGlobalState("subagentsEnabled", isEnabled)

				if (wasEnabled !== isEnabled) {
					telemetryService.captureSubagentToggle(isEnabled)
				}
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
		}

		// Handle secrets updates
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
		throw error
	}
}

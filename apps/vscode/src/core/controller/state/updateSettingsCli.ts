import { Empty } from "@shared/proto/bedrock_coder/common"
import { PlanActMode, UpdateSettingsRequestCli } from "@shared/proto/bedrock_coder/state"
import type { Settings } from "@shared/storage/state-keys"
import { Mode } from "@/shared/storage/types"
import { Controller } from ".."
import { createTaskApiModelShim, resolveActiveModelIdFromApiConfiguration } from "../models/taskApiModel"
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

	if (request.settings) {
		// Extract all special case fields that need dedicated handlers
		// These should NOT be included in the batch update
		const {
			// Fields requiring conversion
			planModeReasoningEffort,
			actModeReasoningEffort,
			mode,
			customPrompt,
			// Fields requiring special logic or merging
			useAutoCondense,
			worktreesEnabled,
			subagentsEnabled,
			browserSettings,
			defaultTerminalProfile,
			...simpleSettings
		} = request.settings

		// Batch update for simple pass-through fields
		const filteredSettings: Partial<Settings> = Object.fromEntries(
			Object.entries(simpleSettings).filter(([key, value]) => key !== "openaiReasoningEffort" && value !== undefined),
		)

		controller.stateManager.setGlobalStateBatch(filteredSettings)

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

		if (controller.task) {
			const currentMode = controller.stateManager.getGlobalSettingsKey("mode")
			const modelId = resolveActiveModelIdFromApiConfiguration(controller.stateManager.getApiConfiguration(), currentMode)
			controller.task.api = createTaskApiModelShim(modelId)
		}

		// Update auto-condense setting
		if (useAutoCondense !== undefined) {
			controller.stateManager.setGlobalState("useAutoCondense", useAutoCondense)
		}

		// Update worktrees setting
		if (worktreesEnabled !== undefined) {
			controller.stateManager.setGlobalState("worktreesEnabled", worktreesEnabled)
		}

		// Update subagents setting
		if (subagentsEnabled !== undefined) {
			const isEnabled = !!subagentsEnabled
			controller.stateManager.setGlobalState("subagentsEnabled", isEnabled)
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

		// Update default terminal profile
		if (defaultTerminalProfile !== undefined && defaultTerminalProfile !== "") {
			controller.stateManager.setGlobalState("defaultTerminalProfile", defaultTerminalProfile)
			// Update the live terminal manager so new terminals use the new profile.
			// Existing terminals are left open — they're keyed by effective shell
			// and reused when compatible, or skipped when not. No session rebuild
			// is needed: the run_commands tool re-reads the profile each time a
			// model request is built, so the description and execution both pick
			// up the new shell at the next request boundary.
			controller.terminalManager?.setDefaultTerminalProfile(defaultTerminalProfile)
		}
	}

	// Handle secrets updates
	if (request.secrets) {
		const filteredSecrets = Object.fromEntries(Object.entries(request.secrets).filter(([_, value]) => value !== undefined))

		controller.stateManager.setSecretsBatch(filteredSecrets)
	}

	// Post updated state to webview
	await controller.postStateToWebview()

	return Empty.create()
}

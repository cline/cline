// Extracted from classic src/core/controller/index.ts (see origin/main)
//
// Standalone function to build ExtensionState from a Controller instance.
// This allows the SdkController to reuse the classic state-building logic
// without inheriting the entire classic Controller implementation.

import { readCompactionStrategyGlobally } from "@bedrock-coder/core"
import { getHooksEnabledSafe } from "@core/hooks/hooks-utils"
import type { ExtensionState, Platform } from "@shared/ExtensionMessage"
import { ExtensionRegistryInfo } from "@/registry"
import { Environment } from "@/shared/config-types"

/**
 * Builds the ExtensionState object to push to the webview.
 * Extracted from the classic Controller.getStateToPostToWebview().
 */
export async function getStateToPostToWebview(controller: {
	task?: any
	stateManager: any
	mcpHub?: any
	backgroundCommandRunning?: boolean
	backgroundCommandTaskId?: string
	foregroundCommandRunning?: boolean
	workspaceManager?: any
	checkpointRestoreInput?: ExtensionState["checkpointRestoreInput"]
}): Promise<ExtensionState> {
	const stateManager = controller.stateManager

	// Get API configuration from cache for immediate access
	const apiConfiguration = stateManager.getApiConfiguration()
	const taskHistory = stateManager.getGlobalStateKey("taskHistory")
	const browserSettings = stateManager.getGlobalSettingsKey("browserSettings")
	const preferredLanguage = stateManager.getGlobalSettingsKey("preferredLanguage")
	const mode = stateManager.getGlobalSettingsKey("mode")
	const useAutoCondense = stateManager.getGlobalSettingsKey("useAutoCondense")
	const compactionStrategy = readCompactionStrategyGlobally()
	const subagentsEnabled = stateManager.getGlobalSettingsKey("subagentsEnabled")
	const mcpDisplayMode = stateManager.getGlobalStateKey("mcpDisplayMode")
	const planActSeparateModelsSetting = stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")
	const enableCheckpointsSetting = stateManager.getGlobalSettingsKey("enableCheckpointsSetting")
	const globalBedrockCoderRulesToggles = stateManager.getGlobalStateKey("globalBedrockCoderRulesToggles")
	const globalWorkflowToggles = stateManager.getGlobalStateKey("globalWorkflowToggles")
	const globalSkillsToggles = stateManager.getGlobalStateKey("globalSkillsToggles")
	const localSkillsToggles = stateManager.getWorkspaceStateKey("localSkillsToggles")
	const shellIntegrationTimeout = stateManager.getGlobalSettingsKey("shellIntegrationTimeout")
	const terminalReuseEnabled = stateManager.getGlobalStateKey("terminalReuseEnabled")
	const vscodeTerminalExecutionMode = stateManager.getGlobalStateKey("vscodeTerminalExecutionMode")
	const defaultTerminalProfile = stateManager.getGlobalSettingsKey("defaultTerminalProfile")
	const isNewUser = stateManager.getGlobalStateKey("isNewUser")
	const welcomeViewCompleted = !!stateManager.getGlobalStateKey("welcomeViewCompleted")

	const customPrompt = stateManager.getGlobalSettingsKey("customPrompt")
	const mcpResponsesCollapsed = stateManager.getGlobalStateKey("mcpResponsesCollapsed")
	const maxConsecutiveMistakes = stateManager.getGlobalSettingsKey("maxConsecutiveMistakes")
	const lastDismissedInfoBannerVersion = stateManager.getGlobalStateKey("lastDismissedInfoBannerVersion") || 0
	const lastDismissedModelBannerVersion = stateManager.getGlobalStateKey("lastDismissedModelBannerVersion") || 0
	const lastDismissedCliBannerVersion = stateManager.getGlobalStateKey("lastDismissedCliBannerVersion") || 0
	const showFeatureTips = stateManager.getGlobalSettingsKey("showFeatureTips")

	const localBedrockCoderRulesToggles = stateManager.getWorkspaceStateKey("localBedrockCoderRulesToggles")
	const localWindsurfRulesToggles = stateManager.getWorkspaceStateKey("localWindsurfRulesToggles")
	const localCursorRulesToggles = stateManager.getWorkspaceStateKey("localCursorRulesToggles")
	const localAgentsRulesToggles = stateManager.getWorkspaceStateKey("localAgentsRulesToggles")
	const workflowToggles = stateManager.getWorkspaceStateKey("workflowToggles")

	const currentTaskItem = controller.task?.taskId
		? (taskHistory || []).find((item: any) => item.id === controller.task?.taskId)
		: undefined
	const bedrockCoderMessages = [...(controller.task?.messageStateHandler?.getBedrockCoderMessages?.() || [])]
	const checkpointRestoreInput = controller.checkpointRestoreInput

	const processedTaskHistory = (taskHistory || [])
		.filter((item: any) => item.ts && item.task)
		.sort((a: any, b: any) => b.ts - a.ts)
		.slice(0, 100)

	const platform = process.platform as Platform
	const version = ExtensionRegistryInfo.version
	const environment = Environment.production

	return {
		version,
		apiConfiguration,
		currentTaskItem,
		bedrockCoderMessages,
		checkpointRestoreInput,
		browserSettings,
		preferredLanguage,
		mode,
		useAutoCondense,
		compactionStrategy,
		subagentsEnabled,
		mcpDisplayMode,
		planActSeparateModelsSetting,
		enableCheckpointsSetting: enableCheckpointsSetting ?? true,
		platform,
		environment,
		globalBedrockCoderRulesToggles: globalBedrockCoderRulesToggles || {},
		localBedrockCoderRulesToggles: localBedrockCoderRulesToggles || {},
		localWindsurfRulesToggles: localWindsurfRulesToggles || {},
		localCursorRulesToggles: localCursorRulesToggles || {},
		localAgentsRulesToggles: localAgentsRulesToggles || {},
		localWorkflowToggles: workflowToggles || {},
		globalWorkflowToggles: globalWorkflowToggles || {},
		globalSkillsToggles: globalSkillsToggles || {},
		localSkillsToggles: localSkillsToggles || {},
		shellIntegrationTimeout,
		terminalReuseEnabled,
		vscodeTerminalExecutionMode,
		defaultTerminalProfile,
		isNewUser,
		welcomeViewCompleted,
		mcpResponsesCollapsed,
		maxConsecutiveMistakes,
		customPrompt,
		taskHistory: processedTaskHistory,
		backgroundCommandRunning: controller.backgroundCommandRunning ?? false,
		backgroundCommandTaskId: controller.backgroundCommandTaskId,
		foregroundCommandRunning: controller.foregroundCommandRunning ?? false,
		workspaceRoots: controller.workspaceManager?.getRoots?.() ?? [],
		primaryRootIndex: controller.workspaceManager?.getPrimaryIndex?.() ?? 0,
		isMultiRootWorkspace: (controller.workspaceManager?.getRoots?.()?.length ?? 0) > 1,
		multiRootSetting: stateManager.getGlobalStateKey("multiRootEnabled"),
		worktreesEnabled: stateManager.getGlobalSettingsKey("worktreesEnabled"),
		hooksEnabled: getHooksEnabledSafe(stateManager.getGlobalSettingsKey("hooksEnabled")),
		lastDismissedInfoBannerVersion,
		lastDismissedModelBannerVersion,
		lastDismissedCliBannerVersion,
		showFeatureTips,
		favoritedModelIds: [],
	} as ExtensionState
}

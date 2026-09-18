import {
	type RuleDirectoryScan,
	synchronizeRuleToggles,
	synchronizeRuleTogglesAcrossDirectories,
} from "@core/context/instructions/user-instructions/rule-helpers"
import { ensureRulesDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { ClineRulesToggles } from "@shared/cline-rules"
import path from "path"
import { Controller } from "@/core/controller"

/**
 * Workspace roots scanned for project rules, in the order the SDK resolves them
 * (`resolveRulesConfigSearchPaths()` in `sdk/packages/shared/src/storage/paths.ts`):
 * the legacy `.clinerules` directory, then `.cline/rules`. A rule is only listed in
 * the Rules panel when it has a toggle, so both roots have to be scanned here.
 */
export function localClineRulesScanDirectories(workingDirectory: string): RuleDirectoryScan[] {
	return [
		{
			directoryPath: path.resolve(workingDirectory, GlobalFileNames.clineRules),
			excludedPaths: [
				[".clinerules", "workflows"],
				[".clinerules", "hooks"],
				[".clinerules", "skills"],
			],
		},
		{ directoryPath: path.resolve(workingDirectory, GlobalFileNames.clineRulesDir) },
	]
}

/**
 * Refreshes the workspace rule toggles from every supported project rule directory
 */
export async function refreshLocalClineRulesToggles(
	controller: Controller,
	workingDirectory: string,
): Promise<ClineRulesToggles> {
	const localClineRulesToggles = controller.stateManager.getWorkspaceStateKey("localClineRulesToggles")
	const updatedLocalToggles = await synchronizeRuleTogglesAcrossDirectories(
		localClineRulesScanDirectories(workingDirectory),
		localClineRulesToggles,
	)
	controller.stateManager.setWorkspaceState("localClineRulesToggles", updatedLocalToggles)
	return updatedLocalToggles
}

export async function refreshClineRulesToggles(
	controller: Controller,
	workingDirectory: string,
): Promise<{
	globalToggles: ClineRulesToggles
	localToggles: ClineRulesToggles
}> {
	// Global toggles
	const globalClineRulesToggles = controller.stateManager.getGlobalSettingsKey("globalClineRulesToggles")
	const globalClineRulesFilePath = await ensureRulesDirectoryExists()
	const updatedGlobalToggles = await synchronizeRuleToggles(globalClineRulesFilePath, globalClineRulesToggles)
	controller.stateManager.setGlobalState("globalClineRulesToggles", updatedGlobalToggles)

	// Local toggles
	const updatedLocalToggles = await refreshLocalClineRulesToggles(controller, workingDirectory)

	return {
		globalToggles: updatedGlobalToggles,
		localToggles: updatedLocalToggles,
	}
}

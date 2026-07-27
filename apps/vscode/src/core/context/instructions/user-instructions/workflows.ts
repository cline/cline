import { synchronizeRuleToggles } from "@core/context/instructions/user-instructions/rule-helpers"
import { ensureWorkflowsDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { ClineRulesToggles } from "@shared/cline-rules"
import path from "path"
import { Controller } from "@/core/controller"

/**
 * Overlay the freshest toggle values onto a directory-scan result. The scan in
 * `synchronizeRuleToggles` is async, so a toggle the user flips mid-scan would
 * otherwise be overwritten by the stale snapshot the scan started from. Keys
 * are limited to the scan result so deleted files still get pruned.
 */
function preferCurrentToggleValues(scanned: ClineRulesToggles, current: ClineRulesToggles): ClineRulesToggles {
	const merged: ClineRulesToggles = { ...scanned }
	for (const key of Object.keys(merged)) {
		if (key in current) {
			merged[key] = current[key]
		}
	}
	return merged
}

/**
 * Refresh the workflow toggles
 */
export async function refreshWorkflowToggles(
	controller: Controller,
	workingDirectory: string,
): Promise<{
	globalWorkflowToggles: ClineRulesToggles
	localWorkflowToggles: ClineRulesToggles
}> {
	// Global workflows
	const globalWorkflowToggles = controller.stateManager.getGlobalSettingsKey("globalWorkflowToggles")
	const globalClineWorkflowsFilePath = await ensureWorkflowsDirectoryExists()
	const scannedGlobalToggles = await synchronizeRuleToggles(globalClineWorkflowsFilePath, globalWorkflowToggles)
	// Re-read state after the async scans: no `await` between here and the
	// writes below, so concurrent toggle updates cannot be lost.
	const updatedGlobalWorkflowToggles = preferCurrentToggleValues(
		scannedGlobalToggles,
		controller.stateManager.getGlobalSettingsKey("globalWorkflowToggles"),
	)
	controller.stateManager.setGlobalState("globalWorkflowToggles", updatedGlobalWorkflowToggles)

	const workflowRulesToggles = controller.stateManager.getWorkspaceStateKey("workflowToggles")
	const workflowsDirPath = path.resolve(workingDirectory, GlobalFileNames.workflows)
	const scannedWorkspaceToggles = await synchronizeRuleToggles(workflowsDirPath, workflowRulesToggles)
	const updatedWorkflowToggles = preferCurrentToggleValues(
		scannedWorkspaceToggles,
		controller.stateManager.getWorkspaceStateKey("workflowToggles"),
	)
	controller.stateManager.setWorkspaceState("workflowToggles", updatedWorkflowToggles)

	return {
		globalWorkflowToggles: updatedGlobalWorkflowToggles,
		localWorkflowToggles: updatedWorkflowToggles,
	}
}

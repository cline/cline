import { synchronizeRuleToggles } from "@core/context/instructions/user-instructions/rule-helpers"
import { ensureWorkflowsDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { ClineRulesToggles } from "@shared/cline-rules"
import path from "path"
import { Controller } from "@/core/controller"

/**
 * Merge a directory-scan result with the toggle state as it stands *after* the
 * scan. The scan in `synchronizeRuleToggles` is async, so state can change
 * while it runs:
 * - a toggle the user flips mid-scan must win over the stale snapshot value;
 * - an entry added mid-scan (e.g. a workflow file created via the modal) must
 *   be kept even though the older scan didn't see the file;
 * - entries that existed before the scan but whose files the scan no longer
 *   found are pruned (the file was deleted).
 */
function mergeToggleStateAfterScan(
	scanned: ClineRulesToggles,
	preScan: ClineRulesToggles,
	current: ClineRulesToggles,
): ClineRulesToggles {
	const merged: ClineRulesToggles = { ...scanned }
	for (const [key, value] of Object.entries(current)) {
		if (key in merged || !(key in preScan)) {
			merged[key] = value
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
	const updatedGlobalWorkflowToggles = mergeToggleStateAfterScan(
		scannedGlobalToggles,
		globalWorkflowToggles,
		controller.stateManager.getGlobalSettingsKey("globalWorkflowToggles"),
	)
	controller.stateManager.setGlobalState("globalWorkflowToggles", updatedGlobalWorkflowToggles)

	const workflowRulesToggles = controller.stateManager.getWorkspaceStateKey("workflowToggles")
	const workflowsDirPath = path.resolve(workingDirectory, GlobalFileNames.workflows)
	const scannedWorkspaceToggles = await synchronizeRuleToggles(workflowsDirPath, workflowRulesToggles)
	const updatedWorkflowToggles = mergeToggleStateAfterScan(
		scannedWorkspaceToggles,
		workflowRulesToggles,
		controller.stateManager.getWorkspaceStateKey("workflowToggles"),
	)
	controller.stateManager.setWorkspaceState("workflowToggles", updatedWorkflowToggles)

	return {
		globalWorkflowToggles: updatedGlobalWorkflowToggles,
		localWorkflowToggles: updatedWorkflowToggles,
	}
}

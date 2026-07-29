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
 * - an entry removed from state mid-scan (e.g. the workflow was deleted via
 *   the modal, which deletes the file and its entry) must stay removed even
 *   though the older scan still saw the file;
 * - entries that existed before the scan but whose files the scan no longer
 *   found are pruned (the file was deleted).
 */
function mergeToggleStateAfterScan(
	scanned: ClineRulesToggles,
	preScan: ClineRulesToggles,
	current: ClineRulesToggles,
): ClineRulesToggles {
	const merged: ClineRulesToggles = {}
	for (const [key, value] of Object.entries(scanned)) {
		if (key in current) {
			merged[key] = current[key]
		} else if (!(key in preScan)) {
			merged[key] = value
		}
		// else: the entry was removed from state while the scan ran — keep it removed.
	}
	for (const [key, value] of Object.entries(current)) {
		if (!(key in scanned) && !(key in preScan)) {
			merged[key] = value
		}
	}
	return merged
}

/**
 * Serializes refresh runs. Overlapping refreshes (webview launch, the rules
 * modal opening, workflow file creation) would otherwise interleave their
 * scans and writes and could publish stale state; queueing them makes each
 * scan atomic relative to other refreshes, and any file create/delete that
 * happens mid-scan triggers its own refresh that queues behind the running
 * one and corrects the outcome. The merge in `mergeToggleStateAfterScan`
 * covers the remaining non-refresh writer: direct toggle flips.
 */
let refreshQueue: Promise<unknown> = Promise.resolve()

/**
 * Refresh the workflow toggles
 */
export function refreshWorkflowToggles(
	controller: Controller,
	workingDirectory: string,
): Promise<{
	globalWorkflowToggles: ClineRulesToggles
	localWorkflowToggles: ClineRulesToggles
}> {
	const run = refreshQueue.then(() => doRefreshWorkflowToggles(controller, workingDirectory))
	refreshQueue = run.catch(() => undefined)
	return run
}

async function doRefreshWorkflowToggles(
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

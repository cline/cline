import { synchronizeRuleToggles } from "@core/context/instructions/user-instructions/rule-helpers"
import { GlobalFileNames, ensureWorkflowsDirectoryExists } from "@core/storage/disk"
import { getGlobalState, getWorkspaceState, updateGlobalState, updateWorkspaceState } from "@core/storage/state"
import { ClineRulesToggles } from "@shared/cline-rules"
import path from "path"
import * as vscode from "vscode"

/**
 * Refresh the workflow toggles
 */
export async function refreshWorkflowToggles(
	context: vscode.ExtensionContext,
	workingDirectory: string,
): Promise<{
	globalWorkflowToggles: ClineRulesToggles
	localWorkflowToggles: ClineRulesToggles
}> {
	// Global workflows
	const globalWorkflowToggles = ((await getGlobalState(context, "globalWorkflowToggles")) as ClineRulesToggles) || {}
	const globalClineWorkflowsFilePath = await ensureWorkflowsDirectoryExists()
	const updatedGlobalWorkflowToggles = await synchronizeRuleToggles(globalClineWorkflowsFilePath, globalWorkflowToggles)
	await updateGlobalState(context, "globalWorkflowToggles", updatedGlobalWorkflowToggles)

	const workflowRulesToggles = ((await getWorkspaceState(context, "workflowToggles")) as ClineRulesToggles) || {}
	const workflowsDirPath = path.resolve(workingDirectory, GlobalFileNames.workflows)
	const updatedWorkflowToggles = await synchronizeRuleToggles(workflowsDirPath, workflowRulesToggles)
	await updateWorkspaceState(context, "workflowToggles", updatedWorkflowToggles)

	return {
		globalWorkflowToggles: updatedGlobalWorkflowToggles,
		localWorkflowToggles: updatedWorkflowToggles,
	}
}

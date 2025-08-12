import path from "path"
import { GlobalFileNames, ensureWorkflowsDirectoryExists } from "@core/storage/disk"
import { ClineRulesToggles } from "@shared/cline-rules"
import { synchronizeRuleToggles } from "@core/context/instructions/user-instructions/rule-helpers"
import { Controller } from "@/core/controller"

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
	const globalWorkflowToggles = controller.cacheService.getGlobalStateKey("globalWorkflowToggles")
	const globalClineWorkflowsFilePath = await ensureWorkflowsDirectoryExists()
	const updatedGlobalWorkflowToggles = await synchronizeRuleToggles(globalClineWorkflowsFilePath, globalWorkflowToggles)
	controller.cacheService.setGlobalState("globalWorkflowToggles", updatedGlobalWorkflowToggles)

	const workflowRulesToggles = controller.cacheService.getWorkspaceStateKey("workflowToggles")
	const workflowsDirPath = path.resolve(workingDirectory, GlobalFileNames.workflows)
	const updatedWorkflowToggles = await synchronizeRuleToggles(workflowsDirPath, workflowRulesToggles)
	controller.cacheService.setWorkspaceState("workflowToggles", updatedWorkflowToggles)

	return {
		globalWorkflowToggles: updatedGlobalWorkflowToggles,
		localWorkflowToggles: updatedWorkflowToggles,
	}
}

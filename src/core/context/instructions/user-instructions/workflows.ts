import path from "path"
import { GlobalFileNames, ensureWorkflowsDirectoryExists } from "@core/storage/disk"
import { ClineRulesToggles } from "@shared/cline-rules"
import { synchronizeRuleToggles } from "@core/context/instructions/user-instructions/rule-helpers"
import { CacheService } from "@/core/storage/CacheService"

/**
 * Refresh the workflow toggles
 */
export async function refreshWorkflowToggles(
	cacheService: CacheService,
	workingDirectory: string,
): Promise<{
	globalWorkflowToggles: ClineRulesToggles
	localWorkflowToggles: ClineRulesToggles
}> {
	// Global workflows
	const globalWorkflowToggles = cacheService.getGlobalStateKey("globalWorkflowToggles")
	const globalClineWorkflowsFilePath = await ensureWorkflowsDirectoryExists()
	const updatedGlobalWorkflowToggles = await synchronizeRuleToggles(globalClineWorkflowsFilePath, globalWorkflowToggles)
	cacheService.setGlobalState("globalWorkflowToggles", updatedGlobalWorkflowToggles)

	const workflowRulesToggles = cacheService.getWorkspaceStateKey("workflowToggles")
	const workflowsDirPath = path.resolve(workingDirectory, GlobalFileNames.workflows)
	const updatedWorkflowToggles = await synchronizeRuleToggles(workflowsDirPath, workflowRulesToggles)
	cacheService.setWorkspaceState("workflowToggles", updatedWorkflowToggles)

	return {
		globalWorkflowToggles: updatedGlobalWorkflowToggles,
		localWorkflowToggles: updatedWorkflowToggles,
	}
}

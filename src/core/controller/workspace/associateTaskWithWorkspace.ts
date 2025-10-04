import { Empty } from "@shared/proto/cline/common"
import { AssociateTaskWithWorkspaceRequest } from "@shared/proto/cline/task"
import { arePathsEqual } from "@/utils/path"
import { readTaskHistoryFromState, writeTaskHistoryToState } from "../../storage/disk"
import { Controller } from ".."

/**
 * Associates a task with a workspace by adding the workspace to the task's workspaceIds
 * @param controller The controller instance
 * @param request Request containing taskId and workspacePath
 * @returns Empty response
 */
export async function associateTaskWithWorkspace(
	controller: Controller,
	request: AssociateTaskWithWorkspaceRequest,
): Promise<Empty> {
	try {
		const { taskId, workspacePath } = request

		// Read global task history
		const globalTaskHistory = await readTaskHistoryFromState()
		const taskIndex = globalTaskHistory.findIndex((item) => item.id === taskId)

		if (taskIndex === -1) {
			console.error(`[associateTaskWithWorkspace] Task ${taskId} not found in global history`)
			return Empty.create({})
		}

		const task = globalTaskHistory[taskIndex]

		// Initialize workspaceIds if not present
		if (!task.workspaceIds) {
			task.workspaceIds = []
		}

		// Check if workspace already associated
		const alreadyAssociated = task.workspaceIds.some((wsPath) => arePathsEqual(wsPath, workspacePath))

		if (!alreadyAssociated) {
			// Add workspace to task's workspaceIds
			task.workspaceIds.push(workspacePath)

			// Update global task history
			globalTaskHistory[taskIndex] = task
			await writeTaskHistoryToState(globalTaskHistory)

			// Also add to current workspace's local task history
			const workspaceTaskHistory = controller.stateManager.getWorkspaceStateKey("taskHistory") || []
			const existsInWorkspaceHistory = workspaceTaskHistory.some((item) => item.id === taskId)

			if (!existsInWorkspaceHistory) {
				workspaceTaskHistory.unshift(task) // Add to beginning
				controller.stateManager.setWorkspaceState("taskHistory", workspaceTaskHistory)
			}

			console.log(`[associateTaskWithWorkspace] Associated task ${taskId} with workspace ${workspacePath}`)
		}

		return Empty.create({})
	} catch (error) {
		console.error("[associateTaskWithWorkspace] Error:", error)
		throw error
	}
}

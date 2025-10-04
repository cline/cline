import { StringRequest } from "@shared/proto/cline/common"
import { TaskResponse } from "@shared/proto/cline/task"
import { arePathsEqual, getWorkspacePath } from "@/utils/path"
import { readTaskHistoryFromState } from "../../storage/disk"
import { Controller } from ".."
import { sendChatButtonClickedEvent } from "../ui/subscribeToChatButtonClicked"

/**
 * Shows a task with the specified ID
 * @param controller The controller instance
 * @param request The request containing the task ID
 * @returns TaskResponse with task details
 */
export async function showTaskWithId(controller: Controller, request: StringRequest): Promise<TaskResponse> {
	try {
		const id = request.value

		// First check if task exists in current workspace state for faster access
		const workspaceTaskHistory = controller.stateManager.getWorkspaceStateKey("taskHistory") || []
		let historyItem = workspaceTaskHistory.find((item) => item.id === id)

		// If not in workspace state, check global aggregated history
		// (This handles cross-workspace tasks shown when "All Workspaces" filter is active)
		if (!historyItem) {
			const globalTaskHistory = await readTaskHistoryFromState()
			historyItem = globalTaskHistory.find((item) => item.id === id)
		}

		// We need to initialize the task before returning data
		if (historyItem) {
			// Check if task is from another workspace
			const currentWorkspacePath = await getWorkspacePath()
			let isCrossWorkspace = false

			if (historyItem.workspaceIds && historyItem.workspaceIds.length > 0) {
				// Task has workspaceIds - check if current workspace is in the list
				isCrossWorkspace = !historyItem.workspaceIds.some((wsPath) => arePathsEqual(wsPath, currentWorkspacePath))
			} else {
				// Legacy task without workspaceIds - check old fields
				const taskWorkspacePath = historyItem.cwdOnTaskInitialization || historyItem.shadowGitConfigWorkTree
				if (taskWorkspacePath) {
					isCrossWorkspace = !arePathsEqual(taskWorkspacePath, currentWorkspacePath)
				}
			}

			// Always initialize the task with the history item
			await controller.initTask(undefined, undefined, undefined, historyItem)

			// Send UI update to show the chat view
			await sendChatButtonClickedEvent()

			// Return task data for gRPC response
			return TaskResponse.create({
				id: historyItem.id,
				task: historyItem.task || "",
				ts: historyItem.ts || 0,
				isFavorited: historyItem.isFavorited || false,
				size: historyItem.size || 0,
				totalCost: historyItem.totalCost || 0,
				tokensIn: historyItem.tokensIn || 0,
				tokensOut: historyItem.tokensOut || 0,
				cacheWrites: historyItem.cacheWrites || 0,
				cacheReads: historyItem.cacheReads || 0,
				isCrossWorkspace,
			})
		}

		// If still not found, try getTaskWithId (checks workspace state again + validates files exist)
		const { historyItem: fetchedItem } = await controller.getTaskWithId(id)

		// Check if task is from another workspace
		const currentWorkspacePath = await getWorkspacePath()
		let isCrossWorkspace = false

		if (fetchedItem.workspaceIds && fetchedItem.workspaceIds.length > 0) {
			isCrossWorkspace = !fetchedItem.workspaceIds.some((wsPath) => arePathsEqual(wsPath, currentWorkspacePath))
		} else {
			const taskWorkspacePath = fetchedItem.cwdOnTaskInitialization || fetchedItem.shadowGitConfigWorkTree
			if (taskWorkspacePath) {
				isCrossWorkspace = !arePathsEqual(taskWorkspacePath, currentWorkspacePath)
			}
		}

		// Initialize the task with the fetched item
		await controller.initTask(undefined, undefined, undefined, fetchedItem)

		// Send UI update to show the chat view
		await sendChatButtonClickedEvent()

		return TaskResponse.create({
			id: fetchedItem.id,
			task: fetchedItem.task || "",
			ts: fetchedItem.ts || 0,
			isFavorited: fetchedItem.isFavorited || false,
			size: fetchedItem.size || 0,
			totalCost: fetchedItem.totalCost || 0,
			tokensIn: fetchedItem.tokensIn || 0,
			tokensOut: fetchedItem.tokensOut || 0,
			cacheWrites: fetchedItem.cacheWrites || 0,
			cacheReads: fetchedItem.cacheReads || 0,
			isCrossWorkspace,
		})
	} catch (error) {
		console.error("Error in showTaskWithId:", error)
		throw error
	}
}

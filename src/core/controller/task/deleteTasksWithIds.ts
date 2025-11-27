import { Empty, StringArrayRequest } from "@shared/proto/cline/common"
import fs from "fs/promises"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { fileExistsAtPath } from "../../../utils/fs"
import { Controller } from ".."

/**
 * Deletes tasks with the specified IDs
 * @param controller The controller instance
 * @param request The request containing an array of task IDs to delete
 * @returns Empty response
 * @throws Error if operation fails
 */
export async function deleteTasksWithIds(controller: Controller, request: StringArrayRequest): Promise<Empty> {
	if (!request.value || request.value.length === 0) {
		throw new Error("Missing task IDs")
	}

	const taskCount = request.value.length
	const message =
		taskCount === 1
			? "Are you sure you want to delete this task? This action cannot be undone."
			: `Are you sure you want to delete these ${taskCount} tasks? This action cannot be undone.`

	const userChoice = await HostProvider.window.showMessage({
		type: ShowMessageType.WARNING,
		message,
		options: { modal: true, items: ["Delete"] },
	})

	if (userChoice.selectedOption !== "Delete") {
		return Empty.create()
	}

	for (const id of request.value) {
		await deleteTaskWithId(controller, id)
	}

	return Empty.create()
}

/**
 * Deletes a single task with the specified ID
 * @param controller The controller instance
 * @param id The task ID to delete
 */
async function deleteTaskWithId(controller: Controller, id: string): Promise<void> {
	try {
		// Clear current task if it matches the ID being deleted
		if (id === controller.task?.taskId) {
			await controller.clearTask()
			console.debug("cleared task")
		}

		// Get task file paths
		const { taskDirPath, apiConversationHistoryFilePath, uiMessagesFilePath, contextHistoryFilePath, taskMetadataFilePath } =
			await controller.getTaskWithId(id)

		// Remove task from state
		const updatedTaskHistory = await controller.deleteTaskFromState(id)

		// Delete the task files
		for (const filePath of [
			apiConversationHistoryFilePath,
			uiMessagesFilePath,
			contextHistoryFilePath,
			taskMetadataFilePath,
		]) {
			await fs.rm(filePath, { force: true })
		}

		// Remove empty task directory
		try {
			await fs.rmdir(taskDirPath) // succeeds if the dir is empty
		} catch (error) {
			console.debug("Could not remove task directory (may not be empty):", error)
		}

		// If no tasks remain, clean up everything
		if (updatedTaskHistory.length === 0) {
			const taskDirPath = path.join(HostProvider.get().globalStorageFsPath, "tasks")
			const checkpointsDirPath = path.join(HostProvider.get().globalStorageFsPath, "checkpoints")

			if (await fileExistsAtPath(taskDirPath)) {
				await fs.rm(taskDirPath, { recursive: true, force: true })
			}
			if (await fileExistsAtPath(checkpointsDirPath)) {
				await fs.rm(checkpointsDirPath, { recursive: true, force: true })
			}
		}
	} catch (error) {
		console.debug(`Error deleting task ${id}:`, error)
		throw error // Re-throw to let caller handle the error
	}

	// Update webview state
	await controller.postStateToWebview()
}

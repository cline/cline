import { Empty, StringArrayRequest } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
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
	// Clear current task if it matches the ID being deleted
	if (id === controller.task?.taskId) {
		await controller.clearTask()
		Logger.debug("cleared task")
	}

	// Remove task from state FIRST — this updates the in-memory cache
	// immediately so the next postStateToWebview() sends the updated list.
	await controller.deleteTaskFromState(id)

	// Always update webview state so the history list and recents refresh
	await controller.postStateToWebview()
}

import { Controller } from ".."
import { StringRequest } from "../../../shared/proto/common"
import { TaskResponse } from "../../../shared/proto/task"
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
		console.log("[TASK_LOAD] Backend: showTaskWithId called with ID:", id)

		// First check if task exists in global state for faster access
		const taskHistory = ((await controller.context.globalState.get("taskHistory")) as any[]) || []
		console.log("[TASK_LOAD] Backend: Total tasks in history:", taskHistory.length)
		const historyItem = taskHistory.find((item) => item.id === id)

		// We need to initialize the task before returning data
		if (historyItem) {
			console.log("[TASK_LOAD] Backend: Found task in global state, initializing...")
			// Always initialize the task with the history item
			await controller.initTask(undefined, undefined, undefined, historyItem)

			// Send UI update to show the chat view
			console.log("[TASK_LOAD] Backend: Sending chat button clicked event")
			await sendChatButtonClickedEvent(controller.id)

			// Return task data for gRPC response
			console.log("[TASK_LOAD] Backend: Returning task data from global state")
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
			})
		}

		// If not in global state, fetch from storage
		console.log("[TASK_LOAD] Backend: Task not in global state, fetching from storage...")
		const { historyItem: fetchedItem } = await controller.getTaskWithId(id)

		// Initialize the task with the fetched item
		console.log("[TASK_LOAD] Backend: Fetched task from storage, initializing...")
		await controller.initTask(undefined, undefined, undefined, fetchedItem)

		// Send UI update to show the chat view
		console.log("[TASK_LOAD] Backend: Sending chat button clicked event")
		await sendChatButtonClickedEvent(controller.id)

		console.log("[TASK_LOAD] Backend: Returning task data from storage")
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
		})
	} catch (error) {
		console.error("[TASK_LOAD] Backend: Error in showTaskWithId:", error)
		throw error
	}
}

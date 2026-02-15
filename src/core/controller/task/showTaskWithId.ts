import { StringRequest } from "@shared/proto/cline/common"
import { TaskResponse } from "@shared/proto/cline/task"
import { Logger } from "@/shared/services/Logger"
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

		// First check if task exists in global state for faster access
		const taskHistory = controller.stateManager.getGlobalStateKey("taskHistory")
		const historyItem = taskHistory.find((item) => item.id === id)

		// Check if this task is already active (running in background)
		const activeTask = controller.getActiveTask(id)
		if (activeTask) {
			// Task is already running - just switch to it without showing resume message
			await controller.switchTask(id)

			// Send UI update to show the chat view
			await sendChatButtonClickedEvent()

			// Return task data from history
			const taskData = historyItem || (await controller.getTaskWithId(id)).historyItem
			return TaskResponse.create({
				id,
				task: taskData.task || "",
				ts: taskData.ts || 0,
				isFavorited: taskData.isFavorited || false,
				size: taskData.size || 0,
				totalCost: taskData.totalCost || 0,
				tokensIn: taskData.tokensIn || 0,
				tokensOut: taskData.tokensOut || 0,
				cacheWrites: taskData.cacheWrites || 0,
				cacheReads: taskData.cacheReads || 0,
			})
		}

		// Task is not active - load from history (will show resume message)
		if (historyItem) {
			// Initialize the task with the history item
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
			})
		}

		// If not in global state, fetch from storage
		const { historyItem: fetchedItem } = await controller.getTaskWithId(id)

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
		})
	} catch (error) {
		Logger.error("Error in showTaskWithId:", error)
		throw error
	}
}

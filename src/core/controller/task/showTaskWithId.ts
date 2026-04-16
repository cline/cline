import { StringRequest } from "@shared/proto/cline/common"
import { TaskResponse } from "@shared/proto/cline/task"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."
import { sendChatButtonClickedEvent } from "../ui/subscribeToChatButtonClicked"

/**
 * Shows a task with the specified ID by loading its messages from disk.
 *
 * This does NOT start a new session or inference — it just loads the task
 * for viewing. The SdkController.showTaskWithId() method handles:
 * 1. Looking up the history item
 * 2. Tearing down any active session
 * 3. Creating a task proxy with loaded messages
 * 4. Pushing messages through both state updates and partial message stream
 * 5. Posting state to the webview
 *
 * Previously this handler called controller.initTask() which started a NEW
 * session instead of loading the existing task's messages (S6-27 bug).
 */
export async function showTaskWithId(controller: Controller, request: StringRequest): Promise<TaskResponse> {
	try {
		const id = request.value

		// Look up the history item for the gRPC response
		const taskHistory = controller.stateManager.getGlobalStateKey("taskHistory")
		const historyItem = taskHistory.find((item) => item.id === id)

		if (!historyItem) {
			// If not in global state, try fetching from storage
			const { historyItem: fetchedItem } = await controller.getTaskWithId(id)
			await controller.showTaskWithId(id)
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
		}

		// Load the task's messages from disk (no new session, no inference)
		await controller.showTaskWithId(id)

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
	} catch (error) {
		Logger.error("Error in showTaskWithId:", error)
		throw error
	}
}

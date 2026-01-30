import { Empty } from "@shared/proto/cline/common"
import { TaskPinRequest } from "@shared/proto/cline/task"
import { Logger } from "@/shared/services/Logger"
import { Controller } from "../"

export async function toggleTaskPin(controller: Controller, request: TaskPinRequest): Promise<Empty> {
	if (!request.taskId || request.isPinned === undefined) {
		const errorMsg = `[toggleTaskPin] Invalid request: taskId or isPinned missing`
		Logger.error(errorMsg)
		return Empty.create({})
	}

	try {
		// Update in-memory state only
		try {
			const history = controller.stateManager.getGlobalStateKey("taskHistory")

			const taskIndex = history.findIndex((item) => item.id === request.taskId)

			if (taskIndex === -1) {
				Logger.log(`[toggleTaskPin] Task not found in history array!`)
			} else {
				// Create a new array instead of modifying in place to ensure state change
				const updatedHistory = [...history]
				updatedHistory[taskIndex] = {
					...updatedHistory[taskIndex],
					isPinned: request.isPinned,
				}

				// Update global state and wait for it to complete
				try {
					controller.stateManager.setGlobalState("taskHistory", updatedHistory)

					// Force immediate write to disk to survive hot reloads
					await controller.stateManager.flushPendingState()
				} catch (stateErr) {
					Logger.error("Error updating global state:", stateErr)
				}
			}
		} catch (historyErr) {
			Logger.error("Error processing task history:", historyErr)
		}

		// Post to webview
		try {
			await controller.postStateToWebview()
		} catch (webviewErr) {
			Logger.error("Error posting to webview:", webviewErr)
		}
	} catch (error) {
		Logger.error("Error in toggleTaskPin:", error)
	}

	return Empty.create({})
}

import { Empty } from "@shared/proto/cline/common"
import { UpdateTaskNameRequest } from "@shared/proto/cline/task"
import { Logger } from "@/shared/services/Logger"
import { Controller } from "../"

export async function updateTaskName(controller: Controller, request: UpdateTaskNameRequest): Promise<Empty> {
	if (!request.taskId) {
		const errorMsg = `[updateTaskName] Invalid request: taskId missing`
		Logger.error(errorMsg)
		return Empty.create({})
	}

	Logger.log(`[updateTaskName] Received request for task ${request.taskId}:`, {
		customName: request.customName,
		customNameColor: request.customNameColor,
	})

	try {
		// Update in-memory state only
		try {
			const history = controller.stateManager.getGlobalStateKey("taskHistory")

			const taskIndex = history.findIndex((item) => item.id === request.taskId)

			if (taskIndex === -1) {
				Logger.log(`[updateTaskName] Task not found in history array!`)
			} else {
				const oldTask = history[taskIndex]
				Logger.log(`[updateTaskName] Current task state:`, {
					customName: oldTask.customName,
					customNameColor: oldTask.customNameColor,
				})

				// Create a new array instead of modifying in place to ensure state change
				const updatedHistory = [...history]
				updatedHistory[taskIndex] = {
					...updatedHistory[taskIndex],
					customName: request.customName || undefined,
					customNameColor: request.customNameColor || undefined,
				}

				Logger.log(`[updateTaskName] Updated task state:`, {
					customName: updatedHistory[taskIndex].customName,
					customNameColor: updatedHistory[taskIndex].customNameColor,
				})

				// Update global state and wait for it to complete
				try {
					controller.stateManager.setGlobalState("taskHistory", updatedHistory)
					Logger.log(`[updateTaskName] Successfully saved to global state`)

					// Force immediate write to disk to survive hot reloads
					await controller.stateManager.flushPendingState()
					Logger.log(`[updateTaskName] Successfully flushed to disk`)
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
		Logger.error("Error in updateTaskName:", error)
	}

	return Empty.create({})
}

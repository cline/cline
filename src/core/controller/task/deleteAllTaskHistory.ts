import path from "path"
import fs from "fs/promises"
import { Controller } from ".."
import { DeleteAllTaskHistoryCount } from "../../../shared/proto/task"
import { getGlobalState, updateGlobalState } from "../../storage/state"
import { fileExistsAtPath } from "../../../utils/fs"
import { ShowMessageRequest, ShowMessageType } from "@/shared/proto/host/window"
import { getHostBridgeProvider } from "@/hosts/host-providers"

/**
 * Deletes all task history, with an option to preserve favorites
 * @param controller The controller instance
 * @param request Request with option to preserve favorites
 * @returns Results with count of deleted tasks
 */
export async function deleteAllTaskHistory(controller: Controller): Promise<DeleteAllTaskHistoryCount> {
	try {
		// Clear current task first
		await controller.clearTask()

		// Get existing task history
		const taskHistory = ((await getGlobalState(controller.context, "taskHistory")) as any[]) || []
		const totalTasks = taskHistory.length

		const userChoice = (
			await getHostBridgeProvider().windowClient.showMessage(
				ShowMessageRequest.create({
					type: ShowMessageType.WARNING,
					message: "What would you like to delete?",
					options: {
						modal: true,
						items: ["Delete All Except Favorites", "Delete Everything"],
					},
				}),
			)
		)?.selectedOption

		// Default VS Code Cancel button returns `undefined` - don't delete anything
		if (userChoice === undefined) {
			return DeleteAllTaskHistoryCount.create({
				tasksDeleted: 0,
			})
		}

		// If preserving favorites, filter out non-favorites
		if (userChoice === "Delete All Except Favorites") {
			const favoritedTasks = taskHistory.filter((task) => task.isFavorited === true)

			// If there are favorited tasks, update state
			if (favoritedTasks.length > 0) {
				await updateGlobalState(controller.context, "taskHistory", favoritedTasks)

				// Delete non-favorited task directories
				const preserveTaskIds = favoritedTasks.map((task) => task.id)
				await cleanupTaskFiles(controller, preserveTaskIds)

				// Update webview
				try {
					await controller.postStateToWebview()
				} catch (webviewErr) {
					console.error("Error posting to webview:", webviewErr)
				}

				return DeleteAllTaskHistoryCount.create({
					tasksDeleted: totalTasks - favoritedTasks.length,
				})
			} else {
				// No favorited tasks found - show warning and ask user what to do
				const answer = (
					await getHostBridgeProvider().windowClient.showMessage(
						ShowMessageRequest.create({
							type: ShowMessageType.WARNING,
							message: "No favorited tasks found. Would you like to delete all tasks anyway?",
							options: {
								modal: true,
								items: ["Delete All Tasks"],
							},
						}),
					)
				)?.selectedOption

				// User cancelled - don't delete anything
				if (answer === undefined) {
					return DeleteAllTaskHistoryCount.create({
						tasksDeleted: 0,
					})
				}
				// If user chose "Delete All Tasks", fall through to the `delete everything` section below
			}
		}

		// Delete everything (not preserving favorites)
		await updateGlobalState(controller.context, "taskHistory", undefined)

		try {
			// Remove all contents of tasks directory
			const taskDirPath = path.join(controller.context.globalStorageUri.fsPath, "tasks")
			if (await fileExistsAtPath(taskDirPath)) {
				await fs.rm(taskDirPath, { recursive: true, force: true })
			}

			// Remove checkpoints directory contents
			const checkpointsDirPath = path.join(controller.context.globalStorageUri.fsPath, "checkpoints")
			if (await fileExistsAtPath(checkpointsDirPath)) {
				await fs.rm(checkpointsDirPath, { recursive: true, force: true })
			}
		} catch (error) {
			getHostBridgeProvider().windowClient.showMessage(
				ShowMessageRequest.create({
					type: ShowMessageType.ERROR,
					message: `Encountered error while deleting task history, there may be some files left behind. Error: ${error instanceof Error ? error.message : String(error)}`,
				}),
			)
		}

		// Update webview
		try {
			await controller.postStateToWebview()
		} catch (webviewErr) {
			console.error("Error posting to webview:", webviewErr)
		}

		return DeleteAllTaskHistoryCount.create({
			tasksDeleted: totalTasks,
		})
	} catch (error) {
		console.error("Error in deleteAllTaskHistory:", error)
		throw error
	}
}

/**
 * Helper function to cleanup task files while preserving specified tasks
 */
async function cleanupTaskFiles(controller: Controller, preserveTaskIds: string[]) {
	const taskDirPath = path.join(controller.context.globalStorageUri.fsPath, "tasks")

	try {
		if (await fileExistsAtPath(taskDirPath)) {
			const taskDirs = await fs.readdir(taskDirPath)
			console.debug(`[cleanupTaskFiles] Found ${taskDirs.length} task directories`)

			// Delete only non-preserved task directories
			for (const dir of taskDirs) {
				if (!preserveTaskIds.includes(dir)) {
					await fs.rm(path.join(taskDirPath, dir), { recursive: true, force: true })
				}
			}
		}
	} catch (error) {
		console.error("Error cleaning up task files:", error)
	}

	return true
}

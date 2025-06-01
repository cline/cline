import path from "path"
import fs from "fs/promises"
import { Controller } from ".."
import { EmptyRequest } from "../../../shared/proto/common"
import { DeleteNonFavoritedTasksResults } from "../../../shared/proto/task"
import { getGlobalState, updateGlobalState } from "../../storage/state"
import { fileExistsAtPath } from "../../../utils/fs"

/**
 * Deletes all non-favorited tasks, preserving only favorited ones
 * @param controller The controller instance
 * @param request Empty request
 * @returns DeleteNonFavoritedTasksResults with counts of preserved and deleted tasks
 */
export async function deleteNonFavoritedTasks(
	controller: Controller,
	_request: EmptyRequest,
): Promise<DeleteNonFavoritedTasksResults> {
	try {
		// Clear current task first
		await controller.clearTask()

		// Get existing task history
		const taskHistory = ((await getGlobalState(controller.context, "taskHistory")) as any[]) || []

		// Filter out non-favorited tasks
		const favoritedTasks = taskHistory.filter((task) => task.isFavorited === true)
		const deletedCount = taskHistory.length - favoritedTasks.length

		console.log(`[deleteNonFavoritedTasks] Found ${favoritedTasks.length} favorited tasks to preserve`)

		// Update global state
		if (favoritedTasks.length > 0) {
			await updateGlobalState(controller.context, "taskHistory", favoritedTasks)
		} else {
			await updateGlobalState(controller.context, "taskHistory", undefined)
		}

		// Handle file system cleanup for deleted tasks
		const preserveTaskIds = favoritedTasks.map((task) => task.id)
		await cleanupTaskFiles(controller, preserveTaskIds)

		// Update webview
		try {
			await controller.postStateToWebview()
		} catch (webviewErr) {
			console.error("Error posting to webview:", webviewErr)
		}

		return DeleteNonFavoritedTasksResults.create({
			tasksPreserved: favoritedTasks.length,
			tasksDeleted: deletedCount,
		})
	} catch (error) {
		console.error("Error in deleteNonFavoritedTasks:", error)
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
			if (preserveTaskIds.length > 0) {
				const taskDirs = await fs.readdir(taskDirPath)
				console.debug(`[cleanupTaskFiles] Found ${taskDirs.length} task directories`)

				// Delete only non-preserved task directories
				for (const dir of taskDirs) {
					if (!preserveTaskIds.includes(dir)) {
						await fs.rm(path.join(taskDirPath, dir), { recursive: true, force: true })
					}
				}
			} else {
				// No tasks to preserve, delete everything
				await fs.rm(taskDirPath, { recursive: true, force: true })
			}
		}
	} catch (error) {
		console.error("Error cleaning up task files:", error)
	}

	return true
}

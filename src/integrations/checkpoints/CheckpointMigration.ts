import { fileExistsAtPath } from "@utils/fs"
import fs from "fs/promises"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"

/**
 * Cleans up legacy checkpoints from task folders.
 * This is a one-time operation that runs when the extension is updated to use the new checkpoint system.
 *
 * @param globalStoragePath - Path to the extension's global storage
 */
export async function cleanupLegacyCheckpoints(): Promise<void> {
	try {
		const tasksDir = path.join(HostProvider.get().globalStorageFsPath, "tasks")

		// Check if tasks directory exists
		if (!(await fileExistsAtPath(tasksDir))) {
			return // No tasks directory, nothing to clean up
		}

		// Get all task folders
		const taskFolders = await fs.readdir(tasksDir)
		if (taskFolders.length === 0) {
			return // No task folders, nothing to clean up
		}

		// Get stats for each folder to sort by creation time
		const folderStats = await Promise.all(
			taskFolders.map(async (folder) => {
				const folderPath = path.join(tasksDir, folder)
				const stats = await fs.stat(folderPath)
				return { folder, path: folderPath, stats }
			}),
		)

		// Sort by creation time, newest first
		folderStats.sort((a, b) => b.stats.birthtimeMs - a.stats.birthtimeMs)

		// Check if the most recent task folder has a checkpoints directory
		if (folderStats.length > 0) {
			const mostRecentFolder = folderStats[0]
			const checkpointsDir = path.join(mostRecentFolder.path, "checkpoints")

			if (await fileExistsAtPath(checkpointsDir)) {
				const results = { deleted: [] as string[], failed: [] as string[] }
				// Legacy checkpoints found, delete checkpoints directories in all task folders
				for (const folder of folderStats) {
					const folderCheckpointsDir = path.join(folder.path, "checkpoints")
					if (await fileExistsAtPath(folderCheckpointsDir)) {
						try {
							await fs.rm(folderCheckpointsDir, { recursive: true, force: true })
							results.deleted.push(folder.folder)
						} catch (_error) {
							// Ignore error if directory removal fails
							results.failed.push(folder.folder)
						}
					}
				}

				Logger.info(
					`Legacy checkpoints cleanup completed. Deleted: ${results.deleted.length}, Failed: ${results.failed.length}`,
				)
			}
		}
	} catch (error) {
		throw new Error("Error cleaning up legacy checkpoints.", { cause: error })
	}
}

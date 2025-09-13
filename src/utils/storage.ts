import getFolderSize from "get-folder-size"
import path from "path"

/**
 * Gets the total size of tasks and checkpoints directories
 * @param storagePath The base storage path (typically globalStorageUri.fsPath)
 * @returns The total size in bytes, or null if calculation fails
 */
export async function getTotalTasksSize(storagePath: string): Promise<number | null> {
	const tasksDir = path.join(storagePath, "tasks")
	const checkpointsDir = path.join(storagePath, "checkpoints")

	try {
		const tasksSize = await getFolderSize.loose(tasksDir)
		const checkpointsSize = await getFolderSize.loose(checkpointsDir)
		return tasksSize + checkpointsSize
	} catch (error) {
		console.error("Failed to calculate total task size:", error)
		return null
	}
}

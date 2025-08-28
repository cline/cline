import { workspaceResolver } from "@core/workspace"
import getFolderSize from "get-folder-size"

/**
 * Gets the total size of tasks and checkpoints directories
 * @param storagePath The base storage path (typically globalStorageUri.fsPath)
 * @returns The total size in bytes, or null if calculation fails
 */
export async function getTotalTasksSize(storagePath: string): Promise<number | null> {
	const tasksDirResult = workspaceResolver.resolveWorkspacePath(storagePath, "tasks", "Utils.storage.getTotalTasksSize")
	const checkpointsDirResult = workspaceResolver.resolveWorkspacePath(
		storagePath,
		"checkpoints",
		"Utils.storage.getTotalTasksSize",
	)

	const tasksDir = typeof tasksDirResult === "string" ? tasksDirResult : tasksDirResult.absolutePath
	const checkpointsDir = typeof checkpointsDirResult === "string" ? checkpointsDirResult : checkpointsDirResult.absolutePath

	try {
		const tasksSize = await getFolderSize.loose(tasksDir)
		const checkpointsSize = await getFolderSize.loose(checkpointsDir)
		return tasksSize + checkpointsSize
	} catch (error) {
		console.error("Failed to calculate total task size:", error)
		return null
	}
}

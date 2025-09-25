import getFolderSize from "get-folder-size"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"

/**
 * Gets the total size of tasks and checkpoints directories
 * @returns The total size in bytes, or null if calculation fails
 */
export async function getTotalTasksSize(): Promise<number | null> {
	const tasksDir = path.resolve(HostProvider.get().globalStorageFsPath, "tasks")
	const checkpointsDir = path.resolve(HostProvider.get().globalStorageFsPath, "checkpoints")

	try {
		const tasksSize = await getFolderSize.loose(tasksDir)
		const checkpointsSize = await getFolderSize.loose(checkpointsDir)
		return tasksSize + checkpointsSize
	} catch (error) {
		console.error("Failed to calculate total task size:", error)
		return null
	}
}

import fs from "fs/promises"
import * as path from "path"

/**
 * Recursively calculates the size of a directory in bytes.
 * Silently ignores errors like permission denied.
 *
 * @param dirPath - The path to the directory to calculate size
 * @returns A promise that resolves to the total size in bytes
 */
export async function calculateDirectorySize(dirPath: string): Promise<number> {
	let size = 0
	try {
		const files = await fs.readdir(dirPath)
		for (const file of files) {
			const filePath = path.join(dirPath, file)
			const stats = await fs.stat(filePath)
			if (stats.isDirectory()) {
				size += await calculateDirectorySize(filePath)
			} else {
				size += stats.size
			}
		}
	} catch (error) {
		// Silently ignore errors like permission denied
		console.error("Failed to calculate directory size:", error)
	}
	return size
}

/**
 * Asynchronously creates all non-existing subdirectories for a given file path
 * and collects them in an array for later deletion.
 *
 * @param filePath - The full path to a file.
 * @returns A promise that resolves to an array of newly created directories.
 */
export async function createDirectoriesForFile(filePath: string): Promise<string[]> {
	const newDirectories: string[] = []
	const normalizedFilePath = path.normalize(filePath) // Normalize path for cross-platform compatibility
	const directoryPath = path.dirname(normalizedFilePath)

	let currentPath = directoryPath
	const dirsToCreate: string[] = []

	// Traverse up the directory tree and collect missing directories
	while (!(await fileExistsAtPath(currentPath))) {
		dirsToCreate.push(currentPath)
		currentPath = path.dirname(currentPath)
	}

	// Create directories from the topmost missing one down to the target directory
	for (let i = dirsToCreate.length - 1; i >= 0; i--) {
		await fs.mkdir(dirsToCreate[i])
		newDirectories.push(dirsToCreate[i])
	}

	return newDirectories
}

/**
 * Helper function to check if a path exists.
 *
 * @param path - The path to check.
 * @returns A promise that resolves to true if the path exists, false otherwise.
 */
export async function fileExistsAtPath(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

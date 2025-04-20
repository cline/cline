import fs from "fs/promises"
import * as path from "path"

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

/**
 * Checks if the path is a directory
 * @param filePath - The path to check.
 * @returns A promise that resolves to true if the path is a directory, false otherwise.
 */
export async function isDirectory(filePath: string): Promise<boolean> {
	try {
		const stats = await fs.stat(filePath)
		return stats.isDirectory()
	} catch {
		return false
	}
}

/**
 * Gets the size of a file in kilobytes
 * @param filePath - Path to the file to check
 * @returns Promise<number> - Size of the file in KB, or 0 if file doesn't exist
 */
export async function getFileSizeInKB(filePath: string): Promise<number> {
	try {
		const stats = await fs.stat(filePath)
		const fileSizeInKB = stats.size / 1000 // Convert bytes to KB (decimal) - matches OS file size display
		return fileSizeInKB
	} catch {
		return 0
	}
}

// Common OS-generated files that would appear in an otherwise clean directory
const OS_GENERATED_FILES = [
	".DS_Store", // macOS Finder
	"Thumbs.db", // Windows Explorer thumbnails
	"desktop.ini", // Windows folder settings
]

/**
 * Recursively reads a directory and returns an array of absolute file paths.
 * Handles symlinks to both files and directories with cycle detection to prevent infinite recursion.
 *
 * @param directoryPath - The path to the directory to read.
 * @param visitedPaths - Set of already visited symlink targets to detect cycles (internal use).
 * @returns A promise that resolves to an array of absolute file paths.
 * @throws Error if the directory cannot be read.
 */
export const readDirectory = async (directoryPath: string, visitedPaths: Set<string> = new Set()) => {
	try {
		const entries = await fs.readdir(directoryPath, { withFileTypes: true, recursive: true })

		const filteredEntries = entries.filter((entry) => !OS_GENERATED_FILES.includes(entry.name))

		const filePaths: string[] = []

		for (const entry of filteredEntries) {
			const fullPath = path.resolve(entry.parentPath, entry.name)

			if (entry.isFile()) {
				filePaths.push(fullPath)
			} else if (entry.isSymbolicLink()) {
				const targetPath = await fs.readlink(fullPath)
				const resolvedPath = path.resolve(path.dirname(fullPath), targetPath)

				// Check for symlink cycles
				if (visitedPaths.has(resolvedPath)) {
					// Skip this symlink as it would create a cycle
					continue
				}

				try {
					const stats = await fs.stat(resolvedPath)

					if (stats.isFile()) {
						filePaths.push(fullPath)
					} else if (stats.isDirectory()) {
						// Add this path to the visited set before recursing
						const newVisitedPaths = new Set(visitedPaths)
						newVisitedPaths.add(resolvedPath)

						const nestedFiles = await readDirectory(resolvedPath, newVisitedPaths)

						for (const nestedFile of nestedFiles) {
							const relativePath = path.relative(resolvedPath, nestedFile)
							filePaths.push(path.join(fullPath, relativePath))
						}
					}
				} catch (error) {
					// Handle broken symlinks or permission issues gracefully
					continue
				}
			}
		}

		return filePaths
	} catch {
		throw new Error(`Error reading directory at ${directoryPath}`)
	}
}

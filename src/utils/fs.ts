import fs from "fs/promises"
import * as path from "path"
import { extractTextFromFile } from "../integrations/misc/extract-text"

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
 * Safely reads a configuration file with size checking
 * @param filePath Path to the configuration file
 * @param contextWindow Context window limit in tokens
 * @returns The file contents as a string
 */
export async function readConfigFile(filePath: string, contextWindow: number): Promise<string> {
	return await extractTextFromFile(filePath, contextWindow)
}

/**
 * Safely reads and parses a JSON configuration file
 * @param filePath Path to the JSON configuration file
 * @param contextWindow Context window limit in tokens
 * @returns The parsed configuration object
 */
export async function readJsonConfigFile<T>(filePath: string, contextWindow: number): Promise<T> {
	try {
		const content = await readConfigFile(filePath, contextWindow)
		return JSON.parse(content) as T
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error(`Invalid JSON in config file ${filePath}: ${error.message}`, { cause: error })
		}
		throw new Error(`Failed to read config file ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
	}
}

/**
 * Helper function to check if a path exists
 * @param filePath The path to check
 * @returns A promise that resolves to true if the path exists, false otherwise
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

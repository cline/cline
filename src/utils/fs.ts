import * as path from "path"
import * as vscode from "vscode"
import { isBinaryFile as isBinaryFileImpl } from "isbinaryfile"

/**
 * Asynchronously creates all non-existing subdirectories for a given file path
 * and collects them in an array for later deletion.
 *
 * @param filePath - The full path to a file.
 * @returns A promise that resolves to an array of newly created directories.
 */
export async function createDirectoriesForFile(filePath: string | vscode.Uri): Promise<string[]> {
	let uri = filePath instanceof vscode.Uri ? filePath : vscode.Uri.parse(filePath)
	const newDirectories: string[] = []
	const normalizedFilePath = path.normalize(uri.fsPath) // Normalize path for cross-platform compatibility
	const directoryPath = path.dirname(normalizedFilePath)

	let currentPath = uri.with({ path: directoryPath })
	const dirsToCreate: vscode.Uri[] = []

	// Traverse up the directory tree and collect missing directories
	while (!(await fileExistsAtPath(currentPath))) {
		dirsToCreate.push(currentPath)
		currentPath = uri.with({ path: path.dirname(currentPath.fsPath) })
	}

	// Create directories from the topmost missing one down to the target directory
	for (let i = dirsToCreate.length - 1; i >= 0; i--) {
		await vscode.workspace.fs.createDirectory(dirsToCreate[i])
		newDirectories.push(dirsToCreate[i].fsPath)
	}

	return newDirectories
}

/**
 * Helper function to check if a path exists.
 *
 * @param path - The path to check.
 * @returns A promise that resolves to true if the path exists, false otherwise.
 */
export async function fileExistsAtPath(filePath: string | vscode.Uri): Promise<boolean> {
	try {
		filePath = filePath instanceof vscode.Uri ? filePath : vscode.Uri.parse(filePath)
		await vscode.workspace.fs.stat(filePath)
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
export async function isDirectory(filePath: string | vscode.Uri): Promise<boolean> {
	try {
		filePath = filePath instanceof vscode.Uri ? filePath : vscode.Uri.parse(filePath)
		const stats = await vscode.workspace.fs.stat(filePath)
		return stats.type === vscode.FileType.Directory
	} catch {
		return false
	}
}

/**
 * Gets the size of a file in kilobytes
 * @param filePath - Path to the file to check
 * @returns Promise<number> - Size of the file in KB, or 0 if file doesn't exist
 */
export async function getFileSizeInKB(filePath: string | vscode.Uri): Promise<number> {
	try {
		filePath = filePath instanceof vscode.Uri ? filePath : vscode.Uri.parse(filePath)
		const stats = await vscode.workspace.fs.stat(filePath)
		const fileSizeInKB = stats.size / 1000 // Convert bytes to KB (decimal) - matches OS file size display
		return fileSizeInKB
	} catch {
		return 0
	}
}

/**
 * Get the file is Binary file
 * note: When operating in a virtual file system, since the interface does not support limiting the size of files being read, files considered to be larger than 1MB are deemed to be binary files.
 * @param filePath - Path to the file to check
 * @returns Promise<boolean> - A promise that resolves to true if the file is binary file, false otherwise.
 */
export async function isBinaryFile(filePath: string | vscode.Uri): Promise<boolean> {
	let uri = filePath instanceof vscode.Uri ? filePath : vscode.Uri.parse(filePath)
	if (uri.scheme === "file") {
		return await isBinaryFileImpl(uri.fsPath)
	} else {
		if ((await getFileSizeInKB(uri)) > 10000) {
			return true
		} else {
			return await isBinaryFileImpl(Buffer.from(await vscode.workspace.fs.readFile(uri)))
		}
	}
}

import { mkdir } from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import os from "os"
import { fileExistsAtPath } from "../../utils/fs"

/**
 * Gets the path to the legacy shadow Git repository in globalStorage.
 * Legacy checkpoints stored each task's checkpoints in a separate git repository
 * under the tasks/{taskId}/checkpoints directory.
 *
 * Legacy path structure:
 * globalStorage/
 *   tasks/
 *     {taskId}/
 *       checkpoints/
 *         .git/
 *
 * @param globalStoragePath - The VS Code global storage path
 * @param taskId - The ID of the task
 * @returns Promise<string> The absolute path to the legacy shadow git directory
 * @throws Error if global storage path is invalid
 */
export async function getLegacyShadowGitPath(globalStoragePath: string, taskId: string): Promise<string> {
	if (!globalStoragePath) {
		throw new Error("Global storage uri is invalid")
	}
	const checkpointsDir = path.join(globalStoragePath, "tasks", taskId, "checkpoints")
	await mkdir(checkpointsDir, { recursive: true })
	const gitPath = path.join(checkpointsDir, ".git")
	console.info(`Legacy shadow git path: ${gitPath}`)
	return gitPath
}

/**
 * Gets the path to the shadow Git repository in globalStorage.
 * For legacy checkpoints, delegates to getLegacyShadowGitPath().
 * For new checkpoints, uses the consolidated branch-per-task structure.
 *
 * Branch-per-task path structure:
 * globalStorage/
 *   checkpoints/
 *     {cwdHash}/
 *       .git/
 *
 * @param globalStoragePath - The VS Code global storage path
 * @param taskId - The ID of the task
 * @param cwdHash - Hash of the working directory path
 * @param isLegacyCheckpoint - Whether this is a legacy checkpoint
 * @returns Promise<string> The absolute path to the shadow git directory
 * @throws Error if global storage path is invalid
 */
export async function getShadowGitPath(
	globalStoragePath: string,
	taskId: string,
	cwdHash: string,
	isLegacyCheckpoint: boolean,
): Promise<string> {
	if (isLegacyCheckpoint) {
		return getLegacyShadowGitPath(globalStoragePath, taskId)
	}
	if (!globalStoragePath) {
		throw new Error("Global storage uri is invalid")
	}
	const checkpointsDir = path.join(globalStoragePath, "checkpoints", cwdHash)
	await mkdir(checkpointsDir, { recursive: true })
	const gitPath = path.join(checkpointsDir, ".git")
	return gitPath
}

/**
 * Gets the current working directory from the VS Code workspace.
 * Validates that checkpoints are not being used in protected directories
 * like home, Desktop, Documents, or Downloads.
 *
 * Protected directories:
 * - User's home directory
 * - Desktop
 * - Documents
 * - Downloads
 *
 * @returns Promise<string> The absolute path to the current working directory
 * @throws Error if no workspace is detected or if in a protected directory
 */
export async function getWorkingDirectory(): Promise<string> {
	const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0)
	if (!cwd) {
		throw new Error("No workspace detected. Please open Cline in a workspace to use checkpoints.")
	}
	const homedir = os.homedir()
	const desktopPath = path.join(homedir, "Desktop")
	const documentsPath = path.join(homedir, "Documents")
	const downloadsPath = path.join(homedir, "Downloads")

	switch (cwd) {
		case homedir:
			throw new Error("Cannot use checkpoints in home directory")
		case desktopPath:
			throw new Error("Cannot use checkpoints in Desktop directory")
		case documentsPath:
			throw new Error("Cannot use checkpoints in Documents directory")
		case downloadsPath:
			throw new Error("Cannot use checkpoints in Downloads directory")
		default:
			return cwd
	}
}

/**
 * Hashes the current working directory to a 13-character numeric hash.
 * @param workingDir - The absolute path to the working directory
 * @returns A 13-character numeric hash string used to identify the workspace
 * @throws {Error} If the working directory path is empty or invalid
 */
export function hashWorkingDir(workingDir: string): string {
	if (!workingDir) {
		throw new Error("Working directory path cannot be empty")
	}
	let hash = 0
	for (let i = 0; i < workingDir.length; i++) {
		hash = (hash * 31 + workingDir.charCodeAt(i)) >>> 0
	}
	const bigHash = BigInt(hash)
	const numericHash = bigHash.toString().slice(0, 13)
	return numericHash
}

/**
 * Detects if a task uses the legacy checkpoint structure.
 * Legacy checkpoints stored each task's checkpoints in a separate git repository
 * under the tasks/{taskId}/checkpoints directory. New checkpoints use a single
 * repository with branches per task.
 *
 * @param globalStoragePath - The VS Code global storage path
 * @param taskId - The ID of the task to check
 * @returns Promise<boolean> True if task uses legacy checkpoint structure, false otherwise
 *
 * Legacy path structure:
 * globalStorage/
 *   tasks/
 *     {taskId}/
 *       checkpoints/
 *         .git/
 *
 * Branch-per-task structure:
 * globalStorage/
 *   checkpoints/
 *     {cwdHash}/
 *       .git/
 */
export async function detectLegacyCheckpoint(globalStoragePath: string | undefined, taskId: string): Promise<boolean> {
	if (!globalStoragePath) {
		return false
	}
	const legacyGitPath = path.join(globalStoragePath, "tasks", taskId, "checkpoints", ".git")
	const isLegacy = await fileExistsAtPath(legacyGitPath)
	console.info(`Legacy checkpoint detection result: ${isLegacy}`)
	return isLegacy
}

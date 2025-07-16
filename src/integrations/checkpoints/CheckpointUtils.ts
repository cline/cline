import { mkdir, access, constants } from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import os from "os"
import { getCwd, getDesktopDir } from "@/utils/path"

/**
 * Gets the path to the shadow Git repository in globalStorage.
 *
 * Checkpoints path structure:
 * globalStorage/
 *   checkpoints/
 *     {cwdHash}/
 *       .git/
 *
 * @param globalStoragePath - The VS Code global storage path
 * @param taskId - The ID of the task
 * @param cwdHash - Hash of the working directory path
 * @returns Promise<string> The absolute path to the shadow git directory
 * @throws Error if global storage path is invalid
 */
export async function getShadowGitPath(globalStoragePath: string, taskId: string, cwdHash: string): Promise<string> {
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
 * like home, Desktop, Documents, or Downloads. Checks to confirm that the workspace
 * is accessible and that we will not encounter breaking permissions issues when
 * creating checkpoints.
 *
 * Protected directories:
 * - User's home directory
 * - Desktop
 * - Documents
 * - Downloads
 *
 * @returns Promise<string> The absolute path to the current working directory
 * @throws Error if no workspace is detected, if in a protected directory, or if no read access
 */
export async function getWorkingDirectory(): Promise<string> {
	const cwd = await getCwd()
	if (!cwd) {
		throw new Error("No workspace detected. Please open Cline in a workspace to use checkpoints.")
	}

	// Check if directory exists and we have read permissions
	try {
		await access(cwd, constants.R_OK)
	} catch (error) {
		throw new Error(
			`Cannot access workspace directory. Please ensure VS Code has permission to access your workspace. Error: ${error instanceof Error ? error.message : String(error)}`,
		)
	}

	const homedir = os.homedir()
	const desktopPath = getDesktopDir()
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

import { access, constants, mkdir } from "fs/promises"
import os from "os"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
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
 * @param cwdHash - Hash of the working directory path
 * @returns Promise<string> The absolute path to the shadow git directory
 * @throws Error if global storage path is invalid
 */
export async function getShadowGitPath(cwdHash: string): Promise<string> {
	const checkpointsDir = path.join(HostProvider.get().globalStorageFsPath, "checkpoints", cwdHash)
	await mkdir(checkpointsDir, { recursive: true })
	const gitPath = path.join(checkpointsDir, ".git")
	return gitPath
}

/**
 * Validates that a workspace path is safe for checkpoints.
 * Checks that checkpoints are not being used in protected directories
 * like home, Desktop, Documents, or Downloads. Also confirms that the workspace
 * is accessible and that we will not encounter breaking permissions issues when
 * creating checkpoints.
 *
 * Protected directories:
 * - User's home directory
 * - Desktop
 * - Documents
 * - Downloads
 *
 * @param workspacePath - The absolute path to the workspace directory to validate
 * @returns Promise<void> Resolves if the path is valid
 * @throws Error if the path is in a protected directory or if no read access
 */
export async function validateWorkspacePath(workspacePath: string): Promise<void> {
	// Check if directory exists and we have read permissions
	try {
		await access(workspacePath, constants.R_OK)
	} catch (error) {
		throw new Error(
			`Cannot access workspace directory. Please ensure VS Code has permission to access your workspace. Error: ${error instanceof Error ? error.message : String(error)}`,
		)
	}

	const homedir = os.homedir()
	const desktopPath = getDesktopDir()
	const documentsPath = path.join(homedir, "Documents")
	const downloadsPath = path.join(homedir, "Downloads")

	switch (workspacePath) {
		case homedir:
			throw new Error("Cannot use checkpoints in home directory")
		case desktopPath:
			throw new Error("Cannot use checkpoints in Desktop directory")
		case documentsPath:
			throw new Error("Cannot use checkpoints in Documents directory")
		case downloadsPath:
			throw new Error("Cannot use checkpoints in Downloads directory")
	}
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

	await validateWorkspacePath(cwd)
	return cwd
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

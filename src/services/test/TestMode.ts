/**
 * Module for managing test mode state across the extension
 * This provides a centralized way to check if the extension is running in test mode
 * instead of relying on process.env which may not be consistent across different parts of the extension
 */
import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import { Logger } from "../logging/Logger"
import { createTestServer, shutdownTestServer } from "./TestServer"
import { getHostBridgeProvider } from "@/hosts/host-providers"

// State variable
let isTestMode = false

/**
 * Sets the test mode state
 * @param value Whether test mode is enabled
 */
export function setTestMode(value: boolean): void {
	isTestMode = value
}

/**
 * Checks if the extension is running in test mode
 * @returns True if in test mode, false otherwise
 */
export function isInTestMode(): boolean {
	return isTestMode
}

/**
 * Check if we're in test mode by looking for evals.env file in workspace folders
 */
async function checkForTestMode(): Promise<boolean> {
	// Get all workspace folders
	const workspaceFolders = await getHostBridgeProvider().workspaceClient.getWorkspacePaths({})

	// Check each workspace folder for an evals.env file
	for (const folder of workspaceFolders.paths) {
		const evalsEnvPath = path.join(folder, "evals.env")
		if (fs.existsSync(evalsEnvPath)) {
			Logger.log(`Found evals.env file at ${evalsEnvPath}, activating test mode`)
			return true
		}
	}

	return false
}

/**
 * Initialize test mode detection and setup file watchers
 * @param webviewProvider The webview provider instance
 */
export async function initializeTestMode(webviewProvider?: any): Promise<vscode.Disposable[]> {
	const disposables: vscode.Disposable[] = []

	// Check if we're in test mode
	const IS_TEST = await checkForTestMode()

	// Set test mode state for other parts of the code
	if (IS_TEST) {
		Logger.log("Test mode detected: Setting test mode state to true")
		setTestMode(true)
		vscode.commands.executeCommand("setContext", "cline.isTestMode", true)

		// Set up test server if in test mode
		createTestServer(webviewProvider)
	}

	// Watch for evals.env files being added or removed
	const evalsEnvWatcher = vscode.workspace.createFileSystemWatcher("**/evals.env")

	// When an evals.env file is created, activate test mode if not already active
	evalsEnvWatcher.onDidCreate(async (uri) => {
		Logger.log(`evals.env file created at ${uri.fsPath}`)
		if (!isInTestMode()) {
			setTestMode(true)
			vscode.commands.executeCommand("setContext", "cline.isTestMode", true)
			createTestServer(webviewProvider)
		}
	})

	// When an evals.env file is deleted, deactivate test mode if no other evals.env files exist
	evalsEnvWatcher.onDidDelete(async (uri) => {
		Logger.log(`evals.env file deleted at ${uri.fsPath}`)
		// Only deactivate if this was the last evals.env file
		if (!checkForTestMode()) {
			setTestMode(false)
			vscode.commands.executeCommand("setContext", "cline.isTestMode", false)
			shutdownTestServer()
		}
	})

	disposables.push(evalsEnvWatcher)

	return disposables
}

/**
 * Clean up test mode resources
 */
export function cleanupTestMode(): void {
	// Shutdown the test server if it exists
	shutdownTestServer()
}

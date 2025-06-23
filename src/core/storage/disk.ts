import * as path from "path"
import * as vscode from "vscode"
import fs from "fs/promises"
import { Anthropic } from "@anthropic-ai/sdk"
import { fileExistsAtPath } from "@utils/fs"
import { ClineMessage } from "@shared/ExtensionMessage"
import { TaskMetadata } from "@core/context/context-tracking/ContextTrackerTypes"
import os from "os"
import { execa } from "@packages/execa"
import { sanitizeStringForJSON } from "@utils/string"
import { isDataValidJSON } from "@utils/validation"

// Helper function to recursively sanitize strings within an object or array
function sanitizeObjectForJSON(data: any): any {
	if (typeof data === "string") {
		return sanitizeStringForJSON(data)
	} else if (Array.isArray(data)) {
		return data.map(sanitizeObjectForJSON)
	} else if (typeof data === "object" && data !== null) {
		const sanitizedObject: { [key: string]: any } = {}
		for (const key in data) {
			if (Object.prototype.hasOwnProperty.call(data, key)) {
				sanitizedObject[key] = sanitizeObjectForJSON(data[key])
			}
		}
		return sanitizedObject
	}
	return data
}

export const GlobalFileNames = {
	apiConversationHistory: "api_conversation_history.json",
	contextHistory: "context_history.json",
	uiMessages: "ui_messages.json",
	openRouterModels: "openrouter_models.json",
	mcpSettings: "cline_mcp_settings.json",
	clineRules: ".clinerules",
	workflows: ".clinerules/workflows",
	cursorRulesDir: ".cursor/rules",
	cursorRulesFile: ".cursorrules",
	windsurfRules: ".windsurfrules",
	taskMetadata: "task_metadata.json",
}

export async function getDocumentsPath(): Promise<string> {
	if (process.platform === "win32") {
		try {
			const { stdout: docsPath } = await execa("powershell", [
				"-NoProfile", // Ignore user's PowerShell profile(s)
				"-Command",
				"[System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::MyDocuments)",
			])
			const trimmedPath = docsPath.trim()
			if (trimmedPath) {
				return trimmedPath
			}
		} catch (err) {
			console.error("Failed to retrieve Windows Documents path. Falling back to homedir/Documents.")
		}
	} else if (process.platform === "linux") {
		try {
			// First check if xdg-user-dir exists
			await execa("which", ["xdg-user-dir"])

			// If it exists, try to get XDG documents path
			const { stdout } = await execa("xdg-user-dir", ["DOCUMENTS"])
			const trimmedPath = stdout.trim()
			if (trimmedPath) {
				return trimmedPath
			}
		} catch {
			// Log error but continue to fallback
			console.error("Failed to retrieve XDG Documents path. Falling back to homedir/Documents.")
		}
	}

	// Default fallback for all platforms
	return path.join(os.homedir(), "Documents")
}

export async function ensureTaskDirectoryExists(context: vscode.ExtensionContext, taskId: string): Promise<string> {
	const config = vscode.workspace.getConfiguration("cline")
	const customTaskStoragePath = config.get<string>("taskStoragePath")?.trim()

	let baseStoragePath: string
	if (customTaskStoragePath && customTaskStoragePath.length > 0) {
		// Ensure the custom path is absolute. If not, this could lead to unpredictable behavior.
		// For simplicity, we'll currently assume users provide a valid absolute path.
		// More robust validation (e.g., checking if path.isAbsolute) could be added.
		if (!path.isAbsolute(customTaskStoragePath)) {
			console.warn(
				`Custom task storage path "${customTaskStoragePath}" is not absolute. Using default global storage.`,
			)
			baseStoragePath = context.globalStorageUri.fsPath
		} else {
			baseStoragePath = customTaskStoragePath
			console.log(`Using custom task storage path: ${baseStoragePath}`)
		}
	} else {
		baseStoragePath = context.globalStorageUri.fsPath
	}

	const taskDir = path.join(baseStoragePath, "tasks", taskId)
	try {
		await fs.mkdir(taskDir, { recursive: true })
	} catch (error) {
		console.error(`Failed to create task directory at ${taskDir}:`, error)
		// Fallback to default global storage if custom path fails, to prevent total failure.
		// This could happen due to permission issues with the custom path.
		if (baseStoragePath !== context.globalStorageUri.fsPath) {
			console.warn(`Falling back to default global storage path due to error with custom path.`)
			baseStoragePath = context.globalStorageUri.fsPath
			const fallbackTaskDir = path.join(baseStoragePath, "tasks", taskId)
			await fs.mkdir(fallbackTaskDir, { recursive: true }) // Attempt with fallback
			return fallbackTaskDir
		}
		throw error // Re-throw if default path also fails
	}
	return taskDir
}

export async function ensureRulesDirectoryExists(): Promise<string> {
	const userDocumentsPath = await getDocumentsPath()
	const clineRulesDir = path.join(userDocumentsPath, "Cline", "Rules")
	try {
		await fs.mkdir(clineRulesDir, { recursive: true })
	} catch (error) {
		return path.join(os.homedir(), "Documents", "Cline", "Rules") // in case creating a directory in documents fails for whatever reason (e.g. permissions) - this is fine because we will fail gracefully with a path that does not exist
	}
	return clineRulesDir
}

export async function ensureWorkflowsDirectoryExists(): Promise<string> {
	const userDocumentsPath = await getDocumentsPath()
	const clineWorkflowsDir = path.join(userDocumentsPath, "Cline", "Workflows")
	try {
		await fs.mkdir(clineWorkflowsDir, { recursive: true })
	} catch (error) {
		return path.join(os.homedir(), "Documents", "Cline", "Workflows") // in case creating a directory in documents fails for whatever reason (e.g. permissions) - this is fine because we will fail gracefully with a path that does not exist
	}
	return clineWorkflowsDir
}

export async function ensureMcpServersDirectoryExists(): Promise<string> {
	const userDocumentsPath = await getDocumentsPath()
	const mcpServersDir = path.join(userDocumentsPath, "Cline", "MCP")
	try {
		await fs.mkdir(mcpServersDir, { recursive: true })
	} catch (error) {
		return "~/Documents/Cline/MCP" // in case creating a directory in documents fails for whatever reason (e.g. permissions) - this is fine since this path is only ever used in the system prompt
	}
	return mcpServersDir
}

export async function ensureSettingsDirectoryExists(context: vscode.ExtensionContext): Promise<string> {
	const settingsDir = path.join(context.globalStorageUri.fsPath, "settings")
	await fs.mkdir(settingsDir, { recursive: true })
	return settingsDir
}

export async function getSavedApiConversationHistory(
	context: vscode.ExtensionContext,
	taskId: string,
): Promise<Anthropic.MessageParam[]> {
	const filePath = path.join(await ensureTaskDirectoryExists(context, taskId), GlobalFileNames.apiConversationHistory)
	const backupFilePath = `${filePath}.bak`

	try {
		if (await fileExistsAtPath(filePath)) {
			let fileContent = await fs.readFile(filePath, "utf8")
			// Strip BOM if present
			if (fileContent.startsWith("\uFEFF")) {
				fileContent = fileContent.substring(1)
			}
			return JSON.parse(fileContent)
		}
	} catch (error) {
		console.warn(`Failed to parse ${filePath}:`, error, "Attempting to restore from backup.")
		try {
			if (await fileExistsAtPath(backupFilePath)) {
				const backupContent = await fs.readFile(backupFilePath, "utf8")
				const jsonData = JSON.parse(backupContent) // Validate backup JSON
				await fs.writeFile(filePath, backupContent, "utf8") // Restore main file from backup
				console.log(`Successfully restored ${filePath} from backup.`)
				return jsonData
			} else {
				console.warn(`Backup file ${backupFilePath} not found.`)
			}
		} catch (backupError) {
			console.error(`Failed to restore ${filePath} from backup:`, backupError)
		}
	}
	return []
}

export async function saveApiConversationHistory(
	context: vscode.ExtensionContext,
	taskId: string,
	apiConversationHistory: Anthropic.MessageParam[],
) {
	try {
		const taskDir = await ensureTaskDirectoryExists(context, taskId)
		const filePath = path.join(taskDir, GlobalFileNames.apiConversationHistory)
		const backupFilePath = `${filePath}.bak`

		// Create backup
		try {
			if (await fileExistsAtPath(filePath)) {
				await fs.copyFile(filePath, backupFilePath)
			}
		} catch (backupError) {
			console.error(`Failed to create backup for ${filePath}:`, backupError)
			// Continue even if backup fails, as saving the current data is more critical
		}

		const sanitizedHistory = sanitizeObjectForJSON(apiConversationHistory)
		if (!isDataValidJSON(sanitizedHistory)) {
			console.error(
				`Skipping save for ${filePath} due to invalid JSON structure after sanitization. Please check the data.`,
			)
			return // Do not write corrupted data
		}

		const stringifiedData = JSON.stringify(sanitizedHistory)
		const dataSizeMB = Buffer.byteLength(stringifiedData, "utf8") / (1024 * 1024)
		if (dataSizeMB > 5) { // Log if data is larger than 5MB
			console.warn(`Saving large API conversation history: ${filePath}, Size: ${dataSizeMB.toFixed(2)}MB`)
		}

		await fs.writeFile(filePath, stringifiedData, "utf8")
	} catch (error) {
		// in the off chance this fails, we don't want to stop the task
		console.error("Failed to save API conversation history:", error)
	}
}

export async function getSavedClineMessages(context: vscode.ExtensionContext, taskId: string): Promise<ClineMessage[]> {
	const taskDir = await ensureTaskDirectoryExists(context, taskId)
	const filePath = path.join(taskDir, GlobalFileNames.uiMessages)
	const backupFilePath = `${filePath}.bak`

	try {
		if (await fileExistsAtPath(filePath)) {
			let fileContent = await fs.readFile(filePath, "utf8")
			// Strip BOM if present
			if (fileContent.startsWith("\uFEFF")) {
				fileContent = fileContent.substring(1)
			}
			return JSON.parse(fileContent)
		}
	} catch (error) {
		console.warn(`Failed to parse ${filePath}:`, error, "Attempting to restore from backup.")
		try {
			if (await fileExistsAtPath(backupFilePath)) {
				const backupContent = await fs.readFile(backupFilePath, "utf8")
				const jsonData = JSON.parse(backupContent) // Validate backup JSON
				await fs.writeFile(filePath, backupContent, "utf8") // Restore main file from backup
				console.log(`Successfully restored ${filePath} from backup.`)
				return jsonData
			} else {
				console.warn(`Backup file ${backupFilePath} not found.`)
			}
		} catch (backupError) {
			console.error(`Failed to restore ${filePath} from backup:`, backupError)
		}
	}

	// If both primary and backup fail, check old location as a last resort
	const oldPath = path.join(taskDir, "claude_messages.json")
	if (await fileExistsAtPath(oldPath)) {
		console.warn(`Primary and backup for ${filePath} failed. Checking old location ${oldPath}.`)
		try {
			const oldFileContent = await fs.readFile(oldPath, "utf8")
			const data = JSON.parse(oldFileContent)
			// Attempt to save it to the new location (this will also create a backup)
			await saveClineMessages(context, taskId, data)
			await fs.unlink(oldPath) // remove old file after successful save
			console.log(`Successfully migrated data from ${oldPath} to ${filePath}.`)
			return data
		} catch (oldFileError) {
			console.error(`Failed to read or migrate from old file ${oldPath}:`, oldFileError)
		}
	}

	return []
}

export async function saveClineMessages(context: vscode.ExtensionContext, taskId: string, uiMessages: ClineMessage[]) {
	try {
		const taskDir = await ensureTaskDirectoryExists(context, taskId)
		const filePath = path.join(taskDir, GlobalFileNames.uiMessages)
		const backupFilePath = `${filePath}.bak`

		// Create backup
		try {
			if (await fileExistsAtPath(filePath)) {
				await fs.copyFile(filePath, backupFilePath)
			}
		} catch (backupError) {
			console.error(`Failed to create backup for ${filePath}:`, backupError)
		}

		const sanitizedMessages = sanitizeObjectForJSON(uiMessages)
		if (!isDataValidJSON(sanitizedMessages)) {
			console.error(
				`Skipping save for ${filePath} due to invalid JSON structure after sanitization. Please check the data.`,
			)
			return // Do not write corrupted data
		}

		const stringifiedData = JSON.stringify(sanitizedMessages)
		const dataSizeMB = Buffer.byteLength(stringifiedData, "utf8") / (1024 * 1024)
		if (dataSizeMB > 5) { // Log if data is larger than 5MB
			console.warn(`Saving large UI messages: ${filePath}, Size: ${dataSizeMB.toFixed(2)}MB`)
		}

		await fs.writeFile(filePath, stringifiedData, "utf8")
	} catch (error) {
		console.error("Failed to save ui messages:", error)
	}
}

export async function getTaskMetadata(context: vscode.ExtensionContext, taskId: string): Promise<TaskMetadata> {
	const filePath = path.join(await ensureTaskDirectoryExists(context, taskId), GlobalFileNames.taskMetadata)
	const backupFilePath = `${filePath}.bak`

	try {
		if (await fileExistsAtPath(filePath)) {
			let fileContent = await fs.readFile(filePath, "utf8")
			// Strip BOM if present
			if (fileContent.startsWith("\uFEFF")) {
				fileContent = fileContent.substring(1)
			}
			return JSON.parse(fileContent)
		}
	} catch (error) {
		console.warn(`Failed to parse ${filePath}:`, error, "Attempting to restore from backup.")
		try {
			if (await fileExistsAtPath(backupFilePath)) {
				const backupContent = await fs.readFile(backupFilePath, "utf8")
				const jsonData = JSON.parse(backupContent) // Validate backup
				await fs.writeFile(filePath, backupContent, "utf8") // Restore main file
				console.log(`Successfully restored ${filePath} from backup.`)
				return jsonData
			} else {
				console.warn(`Backup file ${backupFilePath} not found.`)
			}
		} catch (backupError) {
			console.error(`Failed to restore ${filePath} from backup:`, backupError)
		}
	}
	// Default empty metadata if all attempts fail
	return { files_in_context: [], model_usage: [] }
}

export async function saveTaskMetadata(context: vscode.ExtensionContext, taskId: string, metadata: TaskMetadata) {
	try {
		const taskDir = await ensureTaskDirectoryExists(context, taskId)
		const filePath = path.join(taskDir, GlobalFileNames.taskMetadata)
		const backupFilePath = `${filePath}.bak`

		// Create backup
		try {
			if (await fileExistsAtPath(filePath)) {
				await fs.copyFile(filePath, backupFilePath)
			}
		} catch (backupError) {
			console.error(`Failed to create backup for ${filePath}:`, backupError)
		}

		const sanitizedMetadata = sanitizeObjectForJSON(metadata)
		if (!isDataValidJSON(sanitizedMetadata)) {
			console.error(
				`Skipping save for ${filePath} due to invalid JSON structure after sanitization. Please check the data.`,
			)
			return // Do not write corrupted data
		}

		const stringifiedData = JSON.stringify(sanitizedMetadata, null, 2)
		const dataSizeMB = Buffer.byteLength(stringifiedData, "utf8") / (1024 * 1024)
		if (dataSizeMB > 1) { // Metadata is usually smaller, log if > 1MB
			console.warn(`Saving large task metadata: ${filePath}, Size: ${dataSizeMB.toFixed(2)}MB`)
		}

		await fs.writeFile(filePath, stringifiedData, "utf8")
	} catch (error) {
		console.error("Failed to save task metadata:", error)
	}
}

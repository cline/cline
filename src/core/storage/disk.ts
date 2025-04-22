import * as path from "path"
import * as vscode from "vscode"
import fs from "fs/promises"
import { Anthropic } from "@anthropic-ai/sdk"
import { fileExistsAtPath } from "@utils/fs"
import { ClineMessage } from "@shared/ExtensionMessage"
import { TaskMetadata } from "@core/context/context-tracking/ContextTrackerTypes"
import os from "os"
import { execa } from "execa"

export const GlobalFileNames = {
	apiConversationHistory: "api_conversation_history.json",
	contextHistory: "context_history.json",
	uiMessages: "ui_messages.json",
	openRouterModels: "openrouter_models.json",
	mcpSettings: "cline_mcp_settings.json",
	clineRules: ".clinerules",
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
	const globalStoragePath = context.globalStorageUri.fsPath
	const taskDir = path.join(globalStoragePath, "tasks", taskId)
	await fs.mkdir(taskDir, { recursive: true })
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
	const fileExists = await fileExistsAtPath(filePath)
	if (fileExists) {
		return JSON.parse(await fs.readFile(filePath, "utf8"))
	}
	return []
}

export async function saveApiConversationHistory(
	context: vscode.ExtensionContext,
	taskId: string,
	apiConversationHistory: Anthropic.MessageParam[],
) {
	try {
		const filePath = path.join(await ensureTaskDirectoryExists(context, taskId), GlobalFileNames.apiConversationHistory)
		await fs.writeFile(filePath, JSON.stringify(apiConversationHistory))
	} catch (error) {
		// in the off chance this fails, we don't want to stop the task
		console.error("Failed to save API conversation history:", error)
	}
}

export async function getSavedClineMessages(context: vscode.ExtensionContext, taskId: string): Promise<ClineMessage[]> {
	const filePath = path.join(await ensureTaskDirectoryExists(context, taskId), GlobalFileNames.uiMessages)
	if (await fileExistsAtPath(filePath)) {
		return JSON.parse(await fs.readFile(filePath, "utf8"))
	} else {
		// check old location
		const oldPath = path.join(await ensureTaskDirectoryExists(context, taskId), "claude_messages.json")
		if (await fileExistsAtPath(oldPath)) {
			const data = JSON.parse(await fs.readFile(oldPath, "utf8"))
			await fs.unlink(oldPath) // remove old file
			return data
		}
	}
	return []
}

export async function saveClineMessages(context: vscode.ExtensionContext, taskId: string, uiMessages: ClineMessage[]) {
	try {
		const taskDir = await ensureTaskDirectoryExists(context, taskId)
		const filePath = path.join(taskDir, GlobalFileNames.uiMessages)
		await fs.writeFile(filePath, JSON.stringify(uiMessages))
	} catch (error) {
		console.error("Failed to save ui messages:", error)
	}
}

export async function getTaskMetadata(context: vscode.ExtensionContext, taskId: string): Promise<TaskMetadata> {
	const filePath = path.join(await ensureTaskDirectoryExists(context, taskId), GlobalFileNames.taskMetadata)
	try {
		if (await fileExistsAtPath(filePath)) {
			return JSON.parse(await fs.readFile(filePath, "utf8"))
		}
	} catch (error) {
		console.error("Failed to read task metadata:", error)
	}
	return { files_in_context: [], model_usage: [] }
}

export async function saveTaskMetadata(context: vscode.ExtensionContext, taskId: string, metadata: TaskMetadata) {
	try {
		const taskDir = await ensureTaskDirectoryExists(context, taskId)
		const filePath = path.join(taskDir, GlobalFileNames.taskMetadata)
		await fs.writeFile(filePath, JSON.stringify(metadata, null, 2))
	} catch (error) {
		console.error("Failed to save task metadata:", error)
	}
}

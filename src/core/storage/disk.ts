import * as path from "path"
import * as vscode from "vscode"
import fs from "fs/promises"
import { Anthropic } from "@anthropic-ai/sdk"
import { fileExistsAtPath } from "../../utils/fs"
import { ClineMessage } from "../../shared/ExtensionMessage"
import { CustomInstructionMode, DEFAULT_CUSTOM_INSTRUCTION_MODES } from "../../shared/CustomInstructionMode"

export const GlobalFileNames = {
	apiConversationHistory: "api_conversation_history.json",
	uiMessages: "ui_messages.json",
	openRouterModels: "openrouter_models.json",
	mcpSettings: "cline_mcp_settings.json",
	clineRules: ".clinerules",
	customInstructionModes: "custom_instruction_modes.json", // Added filename for modes
}

// --- Task Specific Storage ---

export async function ensureTaskDirectoryExists(context: vscode.ExtensionContext, taskId: string): Promise<string> {
	const globalStoragePath = context.globalStorageUri.fsPath
	const taskDir = path.join(globalStoragePath, "tasks", taskId)
	await fs.mkdir(taskDir, { recursive: true })
	return taskDir
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

// --- Global Storage (Disk) ---

export async function ensureGlobalStorageDirectoryExists(context: vscode.ExtensionContext): Promise<string> {
	const globalStoragePath = context.globalStorageUri.fsPath
	// Ensure the base global storage directory exists
	await fs.mkdir(globalStoragePath, { recursive: true })
	return globalStoragePath
}

export async function getSavedCustomInstructionModes(context: vscode.ExtensionContext): Promise<CustomInstructionMode[]> {
	const filePath = path.join(await ensureGlobalStorageDirectoryExists(context), GlobalFileNames.customInstructionModes)
	if (await fileExistsAtPath(filePath)) {
		try {
			const content = await fs.readFile(filePath, "utf8")
			const modes = JSON.parse(content)
			// Basic validation to ensure it's an array
			if (Array.isArray(modes)) {
				return modes
			}
			console.error("Invalid format for custom instruction modes file. Returning default.")
		} catch (error) {
			console.error("Failed to read or parse custom instruction modes file:", error)
		}
	}
	return DEFAULT_CUSTOM_INSTRUCTION_MODES // Return default if file doesn't exist or is invalid
}

export async function saveCustomInstructionModes(
	context: vscode.ExtensionContext,
	modes: CustomInstructionMode[],
): Promise<void> {
	try {
		const filePath = path.join(await ensureGlobalStorageDirectoryExists(context), GlobalFileNames.customInstructionModes)
		await fs.writeFile(filePath, JSON.stringify(modes, null, 2)) // Pretty print for readability
	} catch (error) {
		console.error("Failed to save custom instruction modes:", error)
		// Optionally notify the user?
		vscode.window.showErrorMessage("Failed to save custom instruction modes.")
	}
}

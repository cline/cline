import fs from "fs/promises"
import path from "path"
import Anthropic from "@anthropic-ai/sdk"
import { fileExistsAtPath } from "../utils/fs"
import { ClineMessage } from "../shared/ExtensionMessage"
import { GlobalFileNames } from "../global-constants"

// API Conversation History
export async function ensureTaskDirectoryExists(globalStoragePath: string | undefined, taskId: string): Promise<string> {
	if (!globalStoragePath) {
		throw new Error("Global storage uri is invalid")
	}
	const taskDir = path.join(globalStoragePath, "tasks", taskId)
	await fs.mkdir(taskDir, { recursive: true })
	return taskDir
}

export async function getSavedApiConversationHistory(
	globalStoragePath: string | undefined,
	taskId: string,
): Promise<Anthropic.MessageParam[]> {
	const filePath = path.join(await ensureTaskDirectoryExists(globalStoragePath, taskId), GlobalFileNames.apiConversationHistory)
	const fileExists = await fileExistsAtPath(filePath)
	if (fileExists) {
		return JSON.parse(await fs.readFile(filePath, "utf8"))
	}
	return []
}

export async function saveApiConversationHistory(
	globalStoragePath: string | undefined,
	taskId: string,
	apiConversationHistory: Anthropic.MessageParam[],
) {
	try {
		const filePath = path.join(
			await ensureTaskDirectoryExists(globalStoragePath, taskId),
			GlobalFileNames.apiConversationHistory,
		)
		await fs.writeFile(filePath, JSON.stringify(apiConversationHistory))
	} catch (error) {
		// in the off chance this fails, we don't want to stop the task
		console.error("Failed to save API conversation history:", error)
	}
}

// UI Messages

export async function getSavedClineMessages(globalStoragePath: string | undefined, taskId: string): Promise<ClineMessage[]> {
	const filePath = path.join(await ensureTaskDirectoryExists(globalStoragePath, taskId), GlobalFileNames.uiMessages)
	if (await fileExistsAtPath(filePath)) {
		return JSON.parse(await fs.readFile(filePath, "utf8"))
	} else {
		// check old location
		const oldPath = path.join(await ensureTaskDirectoryExists(globalStoragePath, taskId), "claude_messages.json")
		if (await fileExistsAtPath(oldPath)) {
			const data = JSON.parse(await fs.readFile(oldPath, "utf8"))
			await fs.unlink(oldPath) // remove old file
			return data
		}
	}
	return []
}

export async function writeClineMessagesToFile(
	globalStoragePath: string | undefined,
	taskId: string,
	clineMessages: ClineMessage[],
): Promise<string> {
	const taskDir = await ensureTaskDirectoryExists(globalStoragePath, taskId)
	const filePath = path.join(taskDir, GlobalFileNames.uiMessages)
	await fs.writeFile(filePath, JSON.stringify(clineMessages))
	return taskDir
}

import fs from "fs/promises"
import path from "path"
import { GlobalFileNames } from "../global-constants"
import Anthropic from "@anthropic-ai/sdk"
import { fileExistsAtPath } from "../utils/fs"

export async function ensureTaskDirectoryExists(globalStoragePath: string | undefined, taskId: string): Promise<string> {
	if (!globalStoragePath) {
		throw new Error("Global storage uri is invalid")
	}
	const taskDir = path.join(globalStoragePath, "tasks", taskId)
	await fs.mkdir(taskDir, { recursive: true })
	return taskDir
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

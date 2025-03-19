import fs from "fs/promises"
import path from "path"
import { ClineProvider, GlobalFileNames } from "./webview/ClineProvider"
import Anthropic from "@anthropic-ai/sdk"
import { fileExistsAtPath } from "../utils/fs"
import { ClineMessage } from "../shared/ExtensionMessage"
import { getApiMetrics } from "../shared/getApiMetrics"
import { combineApiRequests } from "../shared/combineApiRequests"
import { combineCommandSequences } from "../shared/combineCommandSequences"
import { findLastIndex } from "../shared/array"
import getFolderSize from "get-folder-size"
import CheckpointTracker from "../integrations/checkpoints/CheckpointTracker"

// API Conversation History
export async function ensureTaskDirectoryExists(providerRef: WeakRef<ClineProvider>, taskId: string): Promise<string> {
	const globalStoragePath = providerRef.deref()?.context.globalStorageUri.fsPath
	if (!globalStoragePath) {
		throw new Error("Global storage uri is invalid")
	}
	const taskDir = path.join(globalStoragePath, "tasks", taskId)
	await fs.mkdir(taskDir, { recursive: true })
	return taskDir
}

export async function getSavedApiConversationHistory(
	providerRef: WeakRef<ClineProvider>,
	taskId: string,
): Promise<Anthropic.MessageParam[]> {
	const filePath = path.join(await ensureTaskDirectoryExists(providerRef, taskId), GlobalFileNames.apiConversationHistory)
	const fileExists = await fileExistsAtPath(filePath)
	if (fileExists) {
		return JSON.parse(await fs.readFile(filePath, "utf8"))
	}
	return []
}

export async function saveApiConversationHistory(
	providerRef: WeakRef<ClineProvider>,
	taskId: string,
	apiConversationHistory: Anthropic.MessageParam[],
) {
	try {
		const filePath = path.join(await ensureTaskDirectoryExists(providerRef, taskId), GlobalFileNames.apiConversationHistory)
		await fs.writeFile(filePath, JSON.stringify(apiConversationHistory))
	} catch (error) {
		// in the off chance this fails, we don't want to stop the task
		console.error("Failed to save API conversation history:", error)
	}
}

// UI Messages

export async function getSavedClineMessages(providerRef: WeakRef<ClineProvider>, taskId: string): Promise<ClineMessage[]> {
	const filePath = path.join(await ensureTaskDirectoryExists(providerRef, taskId), GlobalFileNames.uiMessages)
	if (await fileExistsAtPath(filePath)) {
		return JSON.parse(await fs.readFile(filePath, "utf8"))
	} else {
		// check old location
		const oldPath = path.join(await ensureTaskDirectoryExists(providerRef, taskId), "claude_messages.json")
		if (await fileExistsAtPath(oldPath)) {
			const data = JSON.parse(await fs.readFile(oldPath, "utf8"))
			await fs.unlink(oldPath) // remove old file
			return data
		}
	}
	return []
}

export async function saveClineMessages(
	providerRef: WeakRef<ClineProvider>,
	taskId: string,
	clineMessages: ClineMessage[],
	checkpointTracker: CheckpointTracker | undefined,
	conversationHistoryDeletedRange: [number, number] | undefined,
) {
	try {
		const taskDir = await ensureTaskDirectoryExists(providerRef, taskId)
		const filePath = path.join(taskDir, GlobalFileNames.uiMessages)
		await fs.writeFile(filePath, JSON.stringify(clineMessages))
		// combined as they are in ChatView
		const apiMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(clineMessages.slice(1))))
		const taskMessage = clineMessages[0] // first message is always the task say
		const lastRelevantMessage =
			clineMessages[findLastIndex(clineMessages, (m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"))]
		let taskDirSize = 0
		try {
			// getFolderSize.loose silently ignores errors
			// returns # of bytes, size/1000/1000 = MB
			taskDirSize = await getFolderSize.loose(taskDir)
		} catch (error) {
			console.error("Failed to get task directory size:", taskDir, error)
		}
		await providerRef.deref()?.updateTaskHistory({
			id: taskId,
			ts: lastRelevantMessage.ts,
			task: taskMessage.text ?? "",
			tokensIn: apiMetrics.totalTokensIn,
			tokensOut: apiMetrics.totalTokensOut,
			cacheWrites: apiMetrics.totalCacheWrites,
			cacheReads: apiMetrics.totalCacheReads,
			totalCost: apiMetrics.totalCost,
			size: taskDirSize,
			shadowGitConfigWorkTree: await checkpointTracker?.getShadowGitConfigWorkTree(),
			conversationHistoryDeletedRange: conversationHistoryDeletedRange,
		})
	} catch (error) {
		console.error("Failed to save cline messages:", error)
	}
}

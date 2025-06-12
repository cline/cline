import { combineApiRequests } from "@/shared/combineApiRequests"
import { ensureTaskDirectoryExists, saveClineMessages } from "../storage/disk"
import * as vscode from "vscode"
import { ClineMessage } from "@/shared/ExtensionMessage"
import { getApiMetrics } from "@/shared/getApiMetrics"
import { combineCommandSequences } from "@/shared/combineCommandSequences"
import { findLastIndex } from "@/shared/array"
import getFolderSize from "get-folder-size"
import os from "os"
import * as path from "path"
import CheckpointTracker from "@integrations/checkpoints/CheckpointTracker"
import { HistoryItem } from "@/shared/HistoryItem"

const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0) ?? path.join(os.homedir(), "Desktop") // may or may not exist but fs checking existence would immediately ask for permission which would be bad UX, need to come up with a better solution

// need to call getContext() from the task object when passing in context
export async function saveClineMessagesAndUpdateHistory(
	context: vscode.ExtensionContext,
	taskId: string,
	clineMessages: ClineMessage[],
	taskIsFavorited: boolean,
	conversationHistoryDeletedRange: [number, number] | undefined,
	checkpointTracker: CheckpointTracker | undefined,
	updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>,
) {
	try {
		await saveClineMessages(context, taskId, clineMessages)

		// combined as they are in ChatView
		const apiMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(clineMessages.slice(1))))
		const taskMessage = clineMessages[0] // first message is always the task say
		const lastRelevantMessage =
			clineMessages[
				findLastIndex(
					clineMessages,
					(message) => !(message.ask === "resume_task" || message.ask === "resume_completed_task"),
				)
			]
		const taskDir = await ensureTaskDirectoryExists(context, taskId)
		let taskDirSize = 0
		try {
			// getFolderSize.loose silently ignores errors
			// returns # of bytes, size/1000/1000 = MB
			taskDirSize = await getFolderSize.loose(taskDir)
		} catch (error) {
			console.error("Failed to get task directory size:", taskDir, error)
		}
		await updateTaskHistory({
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
			cwdOnTaskInitialization: cwd,
			conversationHistoryDeletedRange: conversationHistoryDeletedRange,
			isFavorited: taskIsFavorited,
		})
	} catch (error) {
		console.error("Failed to save cline messages:", error)
	}
}

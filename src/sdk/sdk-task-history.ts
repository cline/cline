import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { HistoryItem } from "@shared/HistoryItem"
import { GlobalFileNames } from "@/core/storage/disk"
import type { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import { fileExistsAtPath } from "@/utils/fs"
import { readTaskHistory } from "./legacy-state-reader"

export interface TaskWithId {
	historyItem: HistoryItem
	taskDirPath: string
	apiConversationHistoryFilePath: string
	uiMessagesFilePath: string
	contextHistoryFilePath: string
	taskMetadataFilePath: string
	apiConversationHistory: unknown[]
}

export interface TaskUsage {
	tokensIn: number
	tokensOut: number
	totalCost?: number
}

export class SdkTaskHistory {
	constructor(private readonly stateManager: StateManager) {}

	findHistoryItem(taskId: string): HistoryItem | undefined {
		const history = this.getHistory()
		return history.find((item) => item.id === taskId) ?? readTaskHistory().find((item) => item.id === taskId)
	}

	async getTaskWithId(id: string): Promise<TaskWithId> {
		const historyItem = this.getHistory().find((item) => item.id === id)
		if (historyItem) {
			const taskDirPath = path.join(HostProvider.get().globalStorageFsPath, "tasks", id)
			const apiConversationHistoryFilePath = path.join(taskDirPath, GlobalFileNames.apiConversationHistory)
			const uiMessagesFilePath = path.join(taskDirPath, GlobalFileNames.uiMessages)
			const contextHistoryFilePath = path.join(taskDirPath, GlobalFileNames.contextHistory)
			const taskMetadataFilePath = path.join(taskDirPath, GlobalFileNames.taskMetadata)
			const fileExists = await fileExistsAtPath(apiConversationHistoryFilePath)
			if (fileExists) {
				const apiConversationHistory = JSON.parse(await fs.readFile(apiConversationHistoryFilePath, "utf8"))
				return {
					historyItem,
					taskDirPath,
					apiConversationHistoryFilePath,
					uiMessagesFilePath,
					contextHistoryFilePath,
					taskMetadataFilePath,
					apiConversationHistory,
				}
			}
		}

		await this.deleteTaskFromState(id)
		throw new Error("Task not found")
	}

	async deleteTaskFromState(id: string): Promise<HistoryItem[]> {
		const updated = this.getHistory().filter((item) => item.id !== id)
		this.stateManager.setGlobalState("taskHistory", updated)
		return updated
	}

	async updateTaskHistory(item: HistoryItem): Promise<HistoryItem[]> {
		const history = this.getHistory()
		const index = history.findIndex((h) => h.id === item.id)
		if (index >= 0) {
			history[index] = item
		} else {
			history.unshift(item)
		}
		this.stateManager.setGlobalState("taskHistory", history)
		return history
	}

	updateTaskUsage(taskId: string | undefined, usage: TaskUsage): void {
		Logger.log(
			`[SdkController] Task usage: tokensIn=${usage.tokensIn}, tokensOut=${usage.tokensOut}, cost=${usage.totalCost ?? 0}`,
		)

		if (!taskId) {
			return
		}

		const historyItem = this.getHistory().find((item) => item.id === taskId)
		if (!historyItem) {
			return
		}

		historyItem.tokensIn = (historyItem.tokensIn || 0) + usage.tokensIn
		historyItem.tokensOut = (historyItem.tokensOut || 0) + usage.tokensOut
		historyItem.totalCost = (historyItem.totalCost || 0) + (usage.totalCost ?? 0)
		historyItem.ts = Date.now()

		this.updateTaskHistory(historyItem).catch((error) => {
			Logger.error("[SdkController] Failed to persist task usage:", error)
		})
	}

	private getHistory(): HistoryItem[] {
		return (this.stateManager.getGlobalStateKey("taskHistory") as HistoryItem[] | undefined) || []
	}
}

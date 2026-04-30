import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { SessionHistoryRecord } from "@clinebot/core"
import type { Message as SdkMessage } from "@clinebot/llms"
import type { ClineMessage } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import { GlobalFileNames } from "@/core/storage/disk"
import { HostProvider } from "@/hosts/host-provider"
import type { McpHub } from "@/services/mcp/McpHub"
import { Logger } from "@/shared/services/Logger"
import { fileExistsAtPath } from "@/utils/fs"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { VscodeSessionHost } from "./vscode-session-host"

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
	cacheReads?: number
	cacheWrites?: number
}

export interface SdkTaskHistoryOptions {
	mcpHub: McpHub
	sessions: SdkSessionLifecycle
}

function metadataNumber(metadata: SessionHistoryRecord["metadata"] | undefined, key: string): number | undefined {
	const value = metadata?.[key]
	return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function metadataBoolean(metadata: SessionHistoryRecord["metadata"] | undefined, key: string): boolean | undefined {
	const value = metadata?.[key]
	return typeof value === "boolean" ? value : undefined
}

function metadataString(metadata: SessionHistoryRecord["metadata"] | undefined, key: string): string | undefined {
	const value = metadata?.[key]
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function dateStringToTimestamp(value: string | null | undefined): number {
	if (!value) {
		return 0
	}
	const timestamp = Date.parse(value)
	return Number.isFinite(timestamp) ? timestamp : 0
}

function contentToText(content: SdkMessage["content"]): string {
	if (typeof content === "string") {
		return content.trim()
	}

	const text: string[] = []
	for (const block of content) {
		switch (block.type) {
			case "text":
				if (block.text.trim()) {
					text.push(block.text.trim())
				}
				break
			case "thinking":
				if (block.thinking.trim()) {
					text.push(block.thinking.trim())
				}
				break
			case "tool_result":
				if (typeof block.content === "string" && block.content.trim()) {
					text.push(block.content.trim())
				}
				break
		}
	}
	return text.join("\n").trim()
}

export function sdkMessagesToClineMessages(messages: SdkMessage[]): ClineMessage[] {
	const clineMessages: ClineMessage[] = []
	let ts = Date.now()

	for (const message of messages) {
		const text = contentToText(message.content)
		if (!text) {
			continue
		}

		clineMessages.push({
			ts: ++ts,
			type: "say",
			say: message.role === "user" ? "task" : "text",
			text,
			partial: false,
		})
	}

	return clineMessages
}

export function sessionHistoryRecordToHistoryItem(item: SessionHistoryRecord): HistoryItem {
	const metadata = item.metadata
	return {
		id: item.sessionId,
		ts: dateStringToTimestamp(item.updatedAt ?? item.endedAt ?? item.startedAt),
		task: metadataString(metadata, "title") ?? item.prompt ?? "",
		tokensIn: metadataNumber(metadata, "tokensIn") ?? 0,
		tokensOut: metadataNumber(metadata, "tokensOut") ?? 0,
		cacheWrites: metadataNumber(metadata, "cacheWrites") ?? 0,
		cacheReads: metadataNumber(metadata, "cacheReads") ?? 0,
		totalCost: metadataNumber(metadata, "totalCost") ?? 0,
		size: metadataNumber(metadata, "size") ?? 0,
		isFavorited: metadataBoolean(metadata, "isFavorited") ?? metadataBoolean(metadata, "is_favorited") ?? false,
		modelId: item.model || metadataString(metadata, "modelId") || "",
		cwdOnTaskInitialization: item.cwd ?? item.workspaceRoot,
	}
}

export class SdkTaskHistory {
	constructor(private readonly options: SdkTaskHistoryOptions) {}

	private getActiveHistoryHost(): VscodeSessionHost | undefined {
		const sessionManager = this.options.sessions.getActiveSession()?.sessionManager
		if (sessionManager && "listHistory" in sessionManager) {
			return sessionManager as VscodeSessionHost
		}
		return undefined
	}

	private async withHistoryHost<T>(fn: (host: VscodeSessionHost) => Promise<T>): Promise<T> {
		const activeHistoryHost = this.getActiveHistoryHost()
		if (activeHistoryHost) {
			return fn(activeHistoryHost)
		}

		const { VscodeSessionHost } = await import("./vscode-session-host")
		const historyHost = await VscodeSessionHost.create({ mcpHub: this.options.mcpHub })
		try {
			return await fn(historyHost)
		} finally {
			await historyHost.dispose("taskHistory").catch((error) => {
				Logger.warn("[SdkTaskHistory] Failed to dispose history host:", error)
			})
		}
	}

	async listHistory(): Promise<SessionHistoryRecord[]> {
		return this.withHistoryHost((host) => host.listHistory({ limit: 10_000, includeManifestFallback: true }))
	}

	async getClineMessages(taskId: string): Promise<ClineMessage[]> {
		const sdkMessages = await this.withHistoryHost((host) => host.readMessages(taskId) as Promise<SdkMessage[]>)
		return sdkMessagesToClineMessages(sdkMessages)
	}

	private async updateSession(sessionId: string, item: HistoryItem): Promise<void> {
		await this.withHistoryHost(async (host) => {
			const existing = (await host.listHistory({ limit: 10_000, includeManifestFallback: true, hydrate: false })).find(
				(record) => record.sessionId === sessionId,
			)
			const metadata = {
				...(existing?.metadata ?? {}),
				title: item.task,
				isFavorited: item.isFavorited ?? false,
				size: item.size ?? 0,
				totalCost: item.totalCost ?? 0,
				tokensIn: item.tokensIn ?? 0,
				tokensOut: item.tokensOut ?? 0,
				cacheWrites: item.cacheWrites ?? 0,
				cacheReads: item.cacheReads ?? 0,
				modelId: item.modelId ?? existing?.model ?? "",
			}
			await host.update(sessionId, { prompt: item.task, metadata, title: item.task })
		})
	}

	private async deleteSession(sessionId: string): Promise<void> {
		await this.withHistoryHost(async (host) => {
			await host.delete(sessionId)
		})
	}

	async findHistoryItem(taskId: string): Promise<HistoryItem | undefined> {
		const history = await this.listHistory()
		const item = history.find((candidate) => candidate.sessionId === taskId)
		return item ? sessionHistoryRecordToHistoryItem(item) : undefined
	}

	async getTaskWithId(id: string): Promise<TaskWithId> {
		const historyItem = await this.findHistoryItem(id)
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
		await this.deleteSession(id)
		return (await this.listHistory()).map(sessionHistoryRecordToHistoryItem)
	}

	async updateTaskHistory(item: HistoryItem): Promise<HistoryItem[]> {
		await this.updateSession(item.id, item)
		return (await this.listHistory()).map(sessionHistoryRecordToHistoryItem)
	}

	async updateTaskUsage(taskId: string | undefined, usage: TaskUsage): Promise<void> {
		Logger.log(
			`[SdkController] Task usage: tokensIn=${usage.tokensIn}, tokensOut=${usage.tokensOut}, cost=${usage.totalCost ?? 0}`,
		)

		if (!taskId) {
			return
		}

		const historyItem = await this.findHistoryItem(taskId)
		if (!historyItem) {
			return
		}

		historyItem.tokensIn = (historyItem.tokensIn || 0) + usage.tokensIn
		historyItem.tokensOut = (historyItem.tokensOut || 0) + usage.tokensOut
		historyItem.cacheReads = (historyItem.cacheReads || 0) + (usage.cacheReads ?? 0)
		historyItem.cacheWrites = (historyItem.cacheWrites || 0) + (usage.cacheWrites ?? 0)
		historyItem.totalCost = (historyItem.totalCost || 0) + (usage.totalCost ?? 0)
		historyItem.ts = Date.now()

		await this.updateTaskHistory(historyItem)
	}
}

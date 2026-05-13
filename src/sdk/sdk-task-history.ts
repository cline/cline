import type { ClineCoreListHistoryOptions, SessionHistoryRecord } from "@cline/core"
import type { Message as SdkMessage } from "@cline/llms"
import type { ContentBlock, MessageWithMetadata } from "@cline/shared"
import type { ClineMessage } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { McpHub } from "@/services/mcp/McpHub"
import { Logger } from "@/shared/services/Logger"
import { buildSessionConfig } from "./cline-session-factory"
import { sanitizeInitialMessagesForSessionStart } from "./initial-message-sanitizer"
import { readApiConversationHistory, readTaskHistory } from "./legacy-state-reader"
import { sdkMessagesToClineMessages } from "./message-translator"
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

function historyItemToSessionHistoryRecord(item: HistoryItem): SessionHistoryRecord {
	const startedAt = new Date(item.ts || Date.now()).toISOString()
	return {
		sessionId: item.id,
		source: "vscode",
		pid: 0,
		startedAt,
		endedAt: startedAt,
		exitCode: 0,
		status: "completed",
		interactive: true,
		provider: "",
		model: item.modelId ?? "",
		cwd: item.cwdOnTaskInitialization ?? "",
		workspaceRoot: item.cwdOnTaskInitialization ?? "",
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		isSubagent: false,
		prompt: item.task,
		metadata: {
			title: item.task,
			isFavorited: item.isFavorited ?? false,
			size: item.size ?? 0,
			totalCost: item.totalCost ?? 0,
			tokensIn: item.tokensIn ?? 0,
			tokensOut: item.tokensOut ?? 0,
			cacheWrites: item.cacheWrites ?? 0,
			cacheReads: item.cacheReads ?? 0,
			modelId: item.modelId ?? "",
			legacyTask: true,
		},
		updatedAt: startedAt,
	}
}

function anthropicContentBlockToSdkBlock(block: unknown): ContentBlock | undefined {
	if (!block || typeof block !== "object") {
		return undefined
	}
	const record = block as Record<string, unknown>
	switch (record.type) {
		case "text":
			return typeof record.text === "string" ? { type: "text", text: record.text } : undefined
		case "tool_use":
			return typeof record.id === "string" && typeof record.name === "string"
				? { type: "tool_use", id: record.id, name: record.name, input: (record.input as Record<string, unknown>) ?? {} }
				: undefined
		case "tool_result":
			return typeof record.tool_use_id === "string"
				? {
						type: "tool_result",
						tool_use_id: record.tool_use_id,
						content: typeof record.content === "string" ? record.content : JSON.stringify(record.content ?? ""),
						is_error: typeof record.is_error === "boolean" ? record.is_error : undefined,
					}
				: undefined
		case "thinking":
			return typeof record.thinking === "string" ? { type: "thinking", thinking: record.thinking } : undefined
		case "image": {
			const source = record.source as Record<string, unknown> | undefined
			return source?.type === "base64" && typeof source.data === "string" && typeof source.media_type === "string"
				? { type: "image", data: source.data, mediaType: source.media_type }
				: undefined
		}
		default:
			return undefined
	}
}

function legacyApiHistoryToSdkMessages(apiHistory: unknown[], historyItem: HistoryItem): MessageWithMetadata[] {
	const messages = apiHistory.flatMap((raw): MessageWithMetadata[] => {
		if (!raw || typeof raw !== "object") {
			return []
		}
		const record = raw as Record<string, unknown>
		const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : undefined
		if (!role) {
			return []
		}

		if (typeof record.content === "string") {
			return [{ role, content: record.content }]
		}

		if (Array.isArray(record.content)) {
			const content = record.content.flatMap((block) => {
				const converted = anthropicContentBlockToSdkBlock(block)
				return converted ? [converted] : []
			})
			return content.length > 0 ? [{ role, content }] : []
		}

		return []
	})

	const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant")
	if (lastAssistant && !lastAssistant.metrics) {
		lastAssistant.metrics = {
			inputTokens: (historyItem.tokensIn ?? 0) + (historyItem.cacheReads ?? 0) + (historyItem.cacheWrites ?? 0),
			outputTokens: historyItem.tokensOut ?? 0,
			cacheReadTokens: historyItem.cacheReads ?? 0,
			cacheWriteTokens: historyItem.cacheWrites ?? 0,
			cost: historyItem.totalCost ?? 0,
		}
		lastAssistant.modelInfo = historyItem.modelId ? { id: historyItem.modelId, provider: "unknown" } : lastAssistant.modelInfo
	}

	return sanitizeInitialMessagesForSessionStart(messages) as MessageWithMetadata[]
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
		const sdkHost = this.options.sessions.getActiveSession()?.sdkHost
		if (sdkHost && "listHistory" in sdkHost) {
			return sdkHost as VscodeSessionHost
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

	async listHistory(options: ClineCoreListHistoryOptions = {}): Promise<SessionHistoryRecord[]> {
		const sdkHistory = await this.withHistoryHost((host) =>
			host.listHistory({ limit: 10_000, includeManifestFallback: true, ...options }),
		)
		const visibleSdkHistory = sdkHistory.filter((item) => item.isSubagent !== true)
		const sdkIds = new Set(visibleSdkHistory.map((item) => item.sessionId))
		const legacyHistory = readTaskHistory()
			.filter((item) => item.id && item.task && !sdkIds.has(item.id))
			.map(historyItemToSessionHistoryRecord)

		return [...visibleSdkHistory, ...legacyHistory]
			.sort(
				(a, b) =>
					dateStringToTimestamp(b.updatedAt ?? b.endedAt ?? b.startedAt) -
					dateStringToTimestamp(a.updatedAt ?? a.endedAt ?? a.startedAt),
			)
			.slice(0, options.limit ?? 10_000)
	}

	async getClineMessages(taskId: string): Promise<ClineMessage[]> {
		await this.migrateLegacyTaskIfNeeded(taskId)
		const sdkMessages = await this.withHistoryHost((host) => host.readMessages(taskId) as Promise<SdkMessage[]>)
		return sdkMessagesToClineMessages(sdkMessages)
	}

	private async migrateLegacyTaskIfNeeded(taskId: string): Promise<boolean> {
		return this.withHistoryHost(async (host) => {
			try {
				const existing = await host.get(taskId)
				if (existing) {
					return false
				}
			} catch (error) {
				Logger.warn(`[SdkTaskHistory] Failed to check SDK session before legacy migration: ${taskId}`, error)
			}

			const historyItem = readTaskHistory().find((item) => item.id === taskId)
			if (!historyItem) {
				return false
			}

			const legacyApiHistory = readApiConversationHistory(taskId)
			if (legacyApiHistory.length === 0) {
				return false
			}

			const initialMessages = legacyApiHistoryToSdkMessages(legacyApiHistory, historyItem)
			if (initialMessages.length === 0) {
				return false
			}

			const cwd = historyItem.cwdOnTaskInitialization || process.cwd()
			const config = await buildSessionConfig({ cwd, workspaceRoot: cwd, mode: "act" })
			config.sessionId = taskId

			await host.start({
				config,
				prompt: undefined,
				interactive: true,
				initialMessages,
				sessionMetadata: {
					title: historyItem.task,
					isFavorited: historyItem.isFavorited ?? false,
					size: historyItem.size ?? 0,
					totalCost: historyItem.totalCost ?? 0,
					tokensIn: historyItem.tokensIn ?? 0,
					tokensOut: historyItem.tokensOut ?? 0,
					cacheWrites: historyItem.cacheWrites ?? 0,
					cacheReads: historyItem.cacheReads ?? 0,
					modelId: historyItem.modelId ?? "",
					migratedFromLegacyTask: true,
				},
			})

			Logger.log(`[SdkTaskHistory] Migrated legacy task to SDK session: ${taskId}`)
			return true
		})
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

	async deleteTaskFromState(id: string): Promise<HistoryItem[]> {
		await this.deleteSession(id)
		return (await this.listHistory()).map(sessionHistoryRecordToHistoryItem)
	}

	async deleteAllTaskHistory(options: { preserveFavorites?: boolean } = {}): Promise<number> {
		const history = await this.listHistory({ hydrate: false })
		const tasksToDelete = options.preserveFavorites
			? history.filter(
					(item) =>
						!(
							metadataBoolean(item.metadata, "isFavorited") ??
							metadataBoolean(item.metadata, "is_favorited") ??
							false
						),
				)
			: history

		let deletedCount = 0
		await this.withHistoryHost(async (host) => {
			for (const item of tasksToDelete) {
				try {
					await host.delete(item.sessionId)
					deletedCount += 1
				} catch (error) {
					Logger.error(`[SdkTaskHistory] Failed to delete task history item: ${item.sessionId}`, error)
				}
			}
		})

		return deletedCount
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

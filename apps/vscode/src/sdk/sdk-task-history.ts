import path from "node:path"
import type { ClineCoreListHistoryOptions, SessionHistoryRecord } from "@cline/core"
import type { Message as SdkMessage } from "@cline/llms"
import { type ContentBlock, formatDisplayUserInput, type MessageWithMetadata } from "@cline/shared"
import type { ClineMessage } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import getFolderSize from "get-folder-size"
import type { McpHub } from "@/services/mcp/McpHub"
import type { TelemetryService } from "@/services/telemetry/TelemetryService"
import { Logger } from "@/shared/services/Logger"
import { buildSessionConfig } from "./cline-session-factory"
import { sanitizeInitialMessagesForSessionStart } from "./initial-message-sanitizer"
import { deleteLegacyTask, readApiConversationHistory, readTaskHistory } from "./legacy-state-reader"
import type { MessageIdMinter } from "./message-id-minter"
import { sdkMessagesToClineMessages } from "./message-translator"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { VscodeSessionHost } from "./vscode-session-host"

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
	/**
	 * VS Code's legacy global storage root. Pre-SDK VS Code tasks lived here under
	 * state/taskHistory.json and tasks/<id>/ instead of ~/.cline/data.
	 */
	legacyExtensionStorageDir?: string
	/**
	 * The process-wide id/seq/epoch authority. When provided, history rendering mints ids from
	 * it so regenerated history ids never overlap live-session ids. Optional for tests.
	 */
	getMinter?: () => MessageIdMinter
	telemetry?: TelemetryService
}

type SdkTaskHistoryListOptions = ClineCoreListHistoryOptions & {
	offset?: number
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

function historyItemHasTokenUsage(item: HistoryItem): boolean {
	return (item.tokensIn ?? 0) > 0 || (item.tokensOut ?? 0) > 0 || (item.cacheReads ?? 0) > 0 || (item.cacheWrites ?? 0) > 0
}

export function historyItemToSessionMetadata(item: HistoryItem, fallbackModelId?: string): Record<string, unknown> {
	return {
		title: item.task,
		isFavorited: item.isFavorited ?? false,
		size: item.size ?? 0,
		totalCost: item.totalCost ?? 0,
		tokensIn: item.tokensIn ?? 0,
		tokensOut: item.tokensOut ?? 0,
		cacheWrites: item.cacheWrites ?? 0,
		cacheReads: item.cacheReads ?? 0,
		modelId: item.modelId ?? fallbackModelId ?? "",
	}
}

function historyItemToSessionHistoryRecord(item: HistoryItem): SessionHistoryRecord {
	const startedAt = new Date(item.ts || Date.now()).toISOString()
	const displayTask = formatDisplayUserInput(item.task)
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
		prompt: displayTask,
		metadata: {
			...historyItemToSessionMetadata({ ...item, task: displayTask }),
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
				? {
						type: "tool_use",
						id: record.id,
						name: record.name,
						input: (record.input as Record<string, unknown>) ?? {},
					}
				: undefined
		case "tool_result":
			return typeof record.tool_use_id === "string"
				? {
						type: "tool_result",
						tool_use_id: record.tool_use_id,
						// SDK tool_result blocks carry the tool name, but Anthropic-format
						// transcripts identify the tool only by tool_use_id. Use the name
						// when present and otherwise leave it empty.
						name: typeof record.name === "string" ? record.name : "",
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

function sanitizeSdkUserMessagesForDisplay(messages: SdkMessage[]): SdkMessage[] {
	return messages.map((message) => {
		if (message.role !== "user") {
			return message
		}
		if (typeof message.content === "string") {
			return { ...message, content: formatDisplayUserInput(message.content) }
		}
		if (Array.isArray(message.content)) {
			return {
				...message,
				content: message.content.map((block) =>
					block.type === "text" && typeof block.text === "string"
						? { ...block, text: formatDisplayUserInput(block.text) }
						: block,
				),
			}
		}
		return message
	})
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
			return [
				{
					role,
					content: role === "user" ? formatDisplayUserInput(record.content) : record.content,
				},
			]
		}

		if (Array.isArray(record.content)) {
			const content = record.content.flatMap((block) => {
				const converted = anthropicContentBlockToSdkBlock(block)
				if (role === "user" && converted?.type === "text") {
					return [{ ...converted, text: formatDisplayUserInput(converted.text) }]
				}
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
		task: formatDisplayUserInput(metadataString(metadata, "title") ?? item.prompt ?? ""),
		tokensIn: metadataNumber(metadata, "tokensIn") ?? 0,
		tokensOut: metadataNumber(metadata, "tokensOut") ?? 0,
		cacheWrites: metadataNumber(metadata, "cacheWrites") ?? 0,
		cacheReads: metadataNumber(metadata, "cacheReads") ?? 0,
		totalCost: metadataNumber(metadata, "totalCost") ?? 0,
		size: metadataNumber(metadata, "size"),
		isFavorited: metadataBoolean(metadata, "isFavorited") ?? metadataBoolean(metadata, "is_favorited") ?? false,
		modelId: item.model || metadataString(metadata, "modelId") || "",
		cwdOnTaskInitialization: item.cwd ?? item.workspaceRoot,
	}
}

export class SdkTaskHistory {
	private cachedHistoryHost?: VscodeSessionHost
	private cachedHistoryHostPromise?: Promise<VscodeSessionHost>
	private cachedHistoryHostRefCount = 0
	private cachedHistoryHostIdleTimer?: NodeJS.Timeout
	private metadataHistoryCache?: {
		records: SessionHistoryRecord[]
		hostLimit: number
		createdAt: number
	}
	private disposed = false
	private readonly cachedHistoryHostIdleMs = 30_000
	private readonly metadataHistoryCacheTtlMs = 10_000

	constructor(private readonly options: SdkTaskHistoryOptions) {}

	private getLegacyDataDirs(): (string | undefined)[] {
		const dirs: (string | undefined)[] = [undefined]
		const extensionStorageDir = this.options.legacyExtensionStorageDir?.trim()
		if (extensionStorageDir) {
			dirs.push(extensionStorageDir)
		}
		return dirs
	}

	private readAllLegacyTaskHistory(): {
		item: HistoryItem
		dataDir?: string
	}[] {
		const seenIds = new Set<string>()
		const tasks: { item: HistoryItem; dataDir?: string }[] = []
		for (const dataDir of this.getLegacyDataDirs()) {
			for (const item of readTaskHistory(dataDir)) {
				if (!item.id || seenIds.has(item.id)) {
					continue
				}
				seenIds.add(item.id)
				tasks.push({ item, dataDir })
			}
		}
		return tasks
	}

	private findLegacyTask(taskId: string): { item: HistoryItem; dataDir?: string } | undefined {
		return this.readAllLegacyTaskHistory().find(({ item }) => item.id === taskId)
	}

	private getActiveHistoryHost(): VscodeSessionHost | undefined {
		const sdkHost = this.options.sessions.getActiveSession()?.sdkHost
		if (sdkHost && "listHistory" in sdkHost) {
			return sdkHost as VscodeSessionHost
		}
		return undefined
	}

	private async getCachedHistoryHost(): Promise<VscodeSessionHost> {
		if (this.disposed) {
			throw new Error("SdkTaskHistory has been disposed")
		}

		if (this.cachedHistoryHostIdleTimer) {
			clearTimeout(this.cachedHistoryHostIdleTimer)
			this.cachedHistoryHostIdleTimer = undefined
		}

		if (this.cachedHistoryHost) {
			return this.cachedHistoryHost
		}
		if (this.cachedHistoryHostPromise) {
			return this.cachedHistoryHostPromise
		}

		this.cachedHistoryHostPromise = (async () => {
			const { VscodeSessionHost } = await import("./vscode-session-host")
			const historyHost = await VscodeSessionHost.create({
				mcpHub: this.options.mcpHub,
			})
			this.cachedHistoryHost = historyHost
			return historyHost
		})()

		try {
			return await this.cachedHistoryHostPromise
		} catch (error) {
			this.cachedHistoryHost = undefined
			throw error
		} finally {
			this.cachedHistoryHostPromise = undefined
		}
	}

	private scheduleCachedHistoryHostDispose(): void {
		if (this.disposed || this.cachedHistoryHostRefCount > 0 || !this.cachedHistoryHost) {
			return
		}

		this.cachedHistoryHostIdleTimer = setTimeout(() => {
			void this.disposeCachedHistoryHost("idle")
		}, this.cachedHistoryHostIdleMs)
		this.cachedHistoryHostIdleTimer.unref?.()
	}

	private async disposeCachedHistoryHost(reason: string): Promise<void> {
		if (this.cachedHistoryHostIdleTimer) {
			clearTimeout(this.cachedHistoryHostIdleTimer)
			this.cachedHistoryHostIdleTimer = undefined
		}

		if (this.cachedHistoryHostRefCount > 0) {
			return
		}

		const historyHost = this.cachedHistoryHost
		this.cachedHistoryHost = undefined
		if (!historyHost) {
			return
		}

		await historyHost.dispose(`taskHistory:${reason}`).catch((error) => {
			Logger.warn("[SdkTaskHistory] Failed to dispose cached history host:", error)
		})
	}

	async dispose(): Promise<void> {
		this.disposed = true
		this.invalidateMetadataHistoryCache()
		if (this.cachedHistoryHostPromise) {
			await this.cachedHistoryHostPromise.catch(() => undefined)
		}
		await this.disposeCachedHistoryHost("controllerDispose")
	}

	private invalidateMetadataHistoryCache(): void {
		this.metadataHistoryCache = undefined
	}

	private canUseMetadataHistoryCache(options: SdkTaskHistoryListOptions): boolean {
		return options.hydrate === false
	}

	private async withHistoryHost<T>(fn: (host: VscodeSessionHost) => Promise<T>): Promise<T> {
		const activeHistoryHost = this.getActiveHistoryHost()
		if (activeHistoryHost) {
			return fn(activeHistoryHost)
		}

		const historyHost = await this.getCachedHistoryHost()
		this.cachedHistoryHostRefCount += 1
		try {
			return await fn(historyHost)
		} finally {
			this.cachedHistoryHostRefCount = Math.max(0, this.cachedHistoryHostRefCount - 1)
			this.scheduleCachedHistoryHostDispose()
		}
	}

	async listHistory(options: SdkTaskHistoryListOptions = {}): Promise<SessionHistoryRecord[]> {
		const offset = Math.max(0, Math.floor(options.offset ?? 0))
		const limit = Math.max(0, Math.floor(options.limit ?? 10_000))
		const hostLimit = offset + limit
		const useCache = this.canUseMetadataHistoryCache(options)
		const now = Date.now()
		const cached = useCache ? this.metadataHistoryCache : undefined
		if (cached && cached.hostLimit >= hostLimit && now - cached.createdAt < this.metadataHistoryCacheTtlMs) {
			const result = cached.records.slice(offset, offset + limit)
			return result
		}

		const hostOptions: ClineCoreListHistoryOptions = { ...options }
		delete (hostOptions as { offset?: number }).offset

		const sdkHistory = await this.withHistoryHost((host) =>
			host.listHistory({
				...hostOptions,
				limit: hostLimit || 10_000,
				includeManifestFallback: true,
			}),
		)
		const visibleSdkHistory = sdkHistory.filter((item) => item.isSubagent !== true)
		const sdkIds = new Set(visibleSdkHistory.map((item) => item.sessionId))
		const legacyHistory = this.readAllLegacyTaskHistory()
			.filter(({ item }) => item.task && !sdkIds.has(item.id))
			.map(({ item }) => historyItemToSessionHistoryRecord(item))
		const migratedSdkTaskCount = visibleSdkHistory.filter(
			(item) => metadataBoolean(item.metadata, "migratedFromLegacyTask") === true,
		).length

		const mergedHistory = [...visibleSdkHistory, ...legacyHistory].sort(
			(a, b) =>
				dateStringToTimestamp(b.updatedAt ?? b.endedAt ?? b.startedAt) -
				dateStringToTimestamp(a.updatedAt ?? a.endedAt ?? a.startedAt),
		)
		if (useCache) {
			this.metadataHistoryCache = {
				records: mergedHistory,
				hostLimit,
				createdAt: Date.now(),
			}
		}

		this.options.telemetry?.safeCapture(
			() =>
				this.options.telemetry?.captureLegacyTaskMigrationBacklog({
					pendingLegacyTaskCount: legacyHistory.length,
					migratedSdkTaskCount,
					visibleSdkTaskCount: visibleSdkHistory.length,
					visibleTaskCount: mergedHistory.length,
				}),
			"SdkTaskHistory.listHistory.legacyMigrationBacklog",
		)

		const result = mergedHistory.slice(offset, offset + limit)
		return result
	}

	async getClineMessages(taskId: string): Promise<ClineMessage[]> {
		await this.migrateLegacyTaskIfNeeded(taskId)
		const sdkMessages = await this.withHistoryHost((host) => host.readMessages(taskId) as Promise<SdkMessage[]>)
		const clineMessages = sdkMessagesToClineMessages(
			sanitizeSdkUserMessagesForDisplay(sdkMessages),
			this.options.getMinter?.(),
		)
		return clineMessages
	}

	private async migrateLegacyTaskIfNeeded(taskId: string): Promise<boolean> {
		const startedAt = Date.now()
		let sdkLookupFailed = false
		let historyItem: HistoryItem | undefined
		let legacyApiHistoryLength: number | undefined
		let convertedMessageCount: number | undefined

		const emitMigrationTelemetry = (args: { outcome: "success" | "skipped" | "error"; reason: string }) => {
			const payload = {
				taskId,
				outcome: args.outcome,
				reason: args.reason,
				durationMs: Date.now() - startedAt,
				legacyApiHistoryLength,
				convertedMessageCount,
				sdkLookupFailed,
				hasFavorite: historyItem?.isFavorited === true,
				hasCost: (historyItem?.totalCost ?? 0) > 0,
				hasTokenUsage: historyItem ? historyItemHasTokenUsage(historyItem) : undefined,
				hasCwd: !!historyItem?.cwdOnTaskInitialization,
			}
			Logger.log("[SdkTaskHistory] Legacy task migration", payload)
			this.options.telemetry?.safeCapture(
				() => this.options.telemetry?.captureLegacyTaskMigration(payload),
				"SdkTaskHistory.migrateLegacyTaskIfNeeded",
			)
		}

		return this.withHistoryHost(async (host) => {
			try {
				const existing = await host.get(taskId)
				if (existing) {
					emitMigrationTelemetry({ outcome: "skipped", reason: "sdk_exists" })
					return false
				}
			} catch (error) {
				sdkLookupFailed = true
				Logger.warn(`[SdkTaskHistory] Failed to check SDK session before legacy migration: ${taskId}`, error)
			}

			const legacyTask = this.findLegacyTask(taskId)
			historyItem = legacyTask?.item
			if (!historyItem) {
				emitMigrationTelemetry({
					outcome: "skipped",
					reason: "legacy_history_missing",
				})
				return false
			}

			const legacyApiHistory = readApiConversationHistory(taskId, legacyTask?.dataDir)
			legacyApiHistoryLength = legacyApiHistory.length
			if (legacyApiHistory.length === 0) {
				emitMigrationTelemetry({
					outcome: "skipped",
					reason: "legacy_api_history_empty",
				})
				return false
			}

			const initialMessages = legacyApiHistoryToSdkMessages(legacyApiHistory, historyItem)
			convertedMessageCount = initialMessages.length
			if (initialMessages.length === 0) {
				emitMigrationTelemetry({
					outcome: "skipped",
					reason: "converted_messages_empty",
				})
				return false
			}

			const cwd = historyItem.cwdOnTaskInitialization || process.cwd()
			let config: Awaited<ReturnType<typeof buildSessionConfig>>
			try {
				config = await buildSessionConfig({
					cwd,
					workspaceRoot: cwd,
					mode: "act",
				})
				config.sessionId = taskId
			} catch (error) {
				emitMigrationTelemetry({ outcome: "error", reason: "config_failed" })
				throw error
			}

			try {
				await host.start({
					config,
					prompt: undefined,
					interactive: true,
					initialMessages,
					sessionMetadata: {
						...historyItemToSessionMetadata(historyItem),
						migratedFromLegacyTask: true,
					},
				})
			} catch (error) {
				emitMigrationTelemetry({ outcome: "error", reason: "write_failed" })
				throw error
			}

			this.invalidateMetadataHistoryCache()
			Logger.log(`[SdkTaskHistory] Migrated legacy task to SDK session: ${taskId}`)
			emitMigrationTelemetry({ outcome: "success", reason: "migrated" })
			return true
		})
	}

	private async updateSession(sessionId: string, item: HistoryItem): Promise<void> {
		await this.withHistoryHost(async (host) => {
			const existing = await host.get(sessionId)
			const metadata: Record<string, unknown> = {
				...(existing?.metadata ?? {}),
				...historyItemToSessionMetadata(item, existing?.model),
			}
			if (item.size === undefined) {
				const existingSize = existing?.metadata?.size
				if (existingSize !== undefined) {
					metadata.size = existingSize
				} else {
					delete metadata.size
				}
			}
			await host.update(sessionId, {
				prompt: item.task,
				metadata,
				title: item.task,
			})
		})
		this.invalidateMetadataHistoryCache()
	}

	async updateTaskHistoryItem(item: HistoryItem): Promise<void> {
		await this.updateSession(item.id, item)
	}

	private async deleteSession(sessionId: string): Promise<void> {
		const legacyTask = this.findLegacyTask(sessionId)
		await this.withHistoryHost(async (host) => {
			await host.delete(sessionId)
		})
		if (legacyTask) {
			deleteLegacyTask(sessionId, legacyTask.dataDir)
		}
		this.invalidateMetadataHistoryCache()
	}

	async findHistoryItem(taskId: string): Promise<HistoryItem | undefined> {
		const sdkHistoryItem = await this.withHistoryHost(async (host) => {
			const sdkRecord = await host.get(taskId)
			if (!sdkRecord || sdkRecord.isSubagent === true) {
				return undefined
			}

			const historyItem = sessionHistoryRecordToHistoryItem(sdkRecord as SessionHistoryRecord)
			historyItem.size = await this.getCachedTaskSize(host, sdkRecord as SessionHistoryRecord)
			return historyItem
		})
		if (sdkHistoryItem) {
			return sdkHistoryItem
		}

		const legacyItem = this.findLegacyTask(taskId)?.item
		return legacyItem
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
		await this.updateTaskHistoryItem(item)
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

		await this.updateTaskHistoryItem(historyItem)
	}

	private async getCachedTaskSize(host: VscodeSessionHost, record: SessionHistoryRecord): Promise<number | undefined> {
		// metadata.size is a display cache: fill it when absent, and let explicit item.size updates replace it.
		const cachedSize = metadataNumber(record.metadata, "size")
		if (cachedSize !== undefined && cachedSize >= 0) {
			return cachedSize
		}

		const artifactSize = await this.getSessionArtifactSize(record)
		if (artifactSize !== undefined) {
			await this.cacheTaskSize(host, record, artifactSize)
			return artifactSize
		}

		return undefined
	}

	private async getSessionArtifactSize(record: SessionHistoryRecord): Promise<number | undefined> {
		const messagesPath = typeof record.messagesPath === "string" ? record.messagesPath.trim() : ""
		if (!messagesPath) {
			return undefined
		}

		try {
			const size = await getFolderSize.loose(path.dirname(messagesPath), {
				bigint: false,
			})
			return Number.isFinite(size) ? size : undefined
		} catch (error) {
			Logger.warn(`[SdkTaskHistory] Failed to calculate SDK session size: ${record.sessionId}`, error)
			return undefined
		}
	}

	private async cacheTaskSize(host: VscodeSessionHost, record: SessionHistoryRecord, size: number): Promise<void> {
		if (!Number.isFinite(size) || size < 0 || metadataNumber(record.metadata, "size") === size) {
			return
		}

		await host.update(record.sessionId, {
			metadata: {
				...(record.metadata ?? {}),
				size,
			},
		})
		this.invalidateMetadataHistoryCache()
	}
}

import path from "node:path"
import type { ClineCoreListHistoryOptions, SessionHistoryRecord } from "@cline/core"
import type { Message as SdkMessage } from "@cline/llms"
import { formatDisplayUserInput } from "@cline/shared"
import type { ClineMessage } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import getFolderSize from "get-folder-size"
import type { McpHub } from "@/services/mcp/McpHub"
import type { TelemetryService } from "@/services/telemetry/TelemetryService"
import { Logger } from "@/shared/services/Logger"
import { deleteLegacyTask, readApiConversationHistory, readTaskHistory, readUiMessages, taskDirPath } from "./legacy-state-reader"
import {
	appendLegacyResumeWarning,
	legacyApiHistoryToSdkMessages,
	mergeLegacyUiMessagesWithResumedSdkMessages,
} from "./legacy-task-handling"
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

/**
 * Sort comparator for session history records by recency: newest first.
 *
 * Falls back through `updatedAt` → `endedAt` → `startedAt` so records that
 * haven't been touched since creation still sort deterministically. Used both
 * when merging the initial list and when re-sorting after a single-record
 * patch, so the two orderings can never diverge.
 */
function compareSessionHistoryRecordsByRecencyDesc(a: SessionHistoryRecord, b: SessionHistoryRecord): number {
	return (
		dateStringToTimestamp(b.updatedAt ?? b.endedAt ?? b.startedAt) -
		dateStringToTimestamp(a.updatedAt ?? a.endedAt ?? a.startedAt)
	)
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
		legacyTask: item.isLegacy ?? false,
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
		isLegacy:
			metadataBoolean(metadata, "legacyTask") === true || metadataBoolean(metadata, "migratedFromLegacyTask") === true,
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

	/**
	 * Mirror a persistence-layer write into the cache so the next read sees
	 * the updated record without a full re-enumeration.
	 *
	 * The persistence layer bumps `updatedAt` on every write, so the cached
	 * record is updated to match and the cache is re-sorted to preserve the
	 * descending-`updatedAt` ordering that {@link listHistory} establishes.
	 * When the session isn't in the cache (e.g. a brand-new task whose list
	 * membership/ordering may change) the cache is invalidated so the next
	 * read re-enumerates from disk.
	 */
	private updateCachedSessionRecord(
		sessionId: string,
		updates: { prompt: string; metadata: Record<string, unknown>; updatedAt: string },
	): void {
		const cache = this.metadataHistoryCache
		if (!cache) {
			return
		}
		const index = cache.records.findIndex((record) => record.sessionId === sessionId)
		if (index === -1) {
			this.invalidateMetadataHistoryCache()
			return
		}
		const existing = cache.records[index]
		cache.records[index] = {
			...existing,
			prompt: updates.prompt,
			metadata: updates.metadata,
			updatedAt: updates.updatedAt,
		}
		cache.records.sort(compareSessionHistoryRecordsByRecencyDesc)
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

		const mergedHistory = [...visibleSdkHistory, ...legacyHistory].sort(compareSessionHistoryRecordsByRecencyDesc)
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

	private async getSdkRecord(taskId: string): Promise<SessionHistoryRecord | undefined> {
		return this.withHistoryHost((host) => host.get(taskId) as Promise<SessionHistoryRecord | undefined>)
	}

	async getClineMessages(taskId: string): Promise<ClineMessage[]> {
		const sdkRecord = await this.getSdkRecord(taskId)
		const legacyTask = this.findLegacyTask(taskId)
		if (!sdkRecord && legacyTask) {
			return readUiMessages(taskId, legacyTask.dataDir)
		}

		const sdkMessages = await this.withHistoryHost((host) => host.readMessages(taskId) as Promise<SdkMessage[]>)
		const clineMessages = sdkMessagesToClineMessages(
			sanitizeSdkUserMessagesForDisplay(sdkMessages),
			this.options.getMinter?.(),
		)
		if (sdkRecord && legacyTask) {
			return mergeLegacyUiMessagesWithResumedSdkMessages(readUiMessages(taskId, legacyTask.dataDir), clineMessages)
		}
		return clineMessages
	}

	async isLegacyTask(taskId: string): Promise<boolean> {
		const sdkRecord = await this.getSdkRecord(taskId)
		if (sdkRecord) {
			return (
				metadataBoolean(sdkRecord.metadata, "legacyTask") === true ||
				metadataBoolean(sdkRecord.metadata, "migratedFromLegacyTask") === true
			)
		}

		return this.findLegacyTask(taskId) !== undefined
	}

	async getLegacyResumeInitialMessages(taskId: string, fallbackMessages?: unknown[]): Promise<unknown[] | undefined> {
		const sdkRecord = await this.getSdkRecord(taskId)
		const legacyTask = sdkRecord ? undefined : this.findLegacyTask(taskId)
		if (legacyTask) {
			const legacyApiHistory = readApiConversationHistory(taskId, legacyTask.dataDir)
			if (legacyApiHistory.length > 0) {
				return legacyApiHistoryToSdkMessages(legacyApiHistory, legacyTask.item)
			}
		}

		if (!fallbackMessages) {
			return undefined
		}
		return appendLegacyResumeWarning(fallbackMessages as { role: string; content: unknown }[])
	}

	getLegacyTaskDirPath(taskId: string): string | undefined {
		const legacyTask = this.findLegacyTask(taskId)
		return legacyTask ? taskDirPath(taskId, legacyTask.dataDir) : undefined
	}

	private async updateSession(sessionId: string, item: HistoryItem): Promise<void> {
		const { metadata: writtenMetadata, updated } = await this.withHistoryHost(async (host) => {
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
			const result = await host.update(sessionId, {
				prompt: item.task,
				metadata,
				title: item.task,
			})
			return { metadata, updated: result.updated }
		})
		if (!updated) {
			// The write didn't land (e.g. the session was deleted, or an optimistic-
			// concurrency retry was exhausted by a racing writer). Patching the cache
			// here would show a fake "updated" record until the TTL expires, so
			// invalidate instead and let the next read re-enumerate from disk.
			this.invalidateMetadataHistoryCache()
			return
		}
		// The persistence adapter stamps `updatedAt` with the wall-clock write time
		// (see `nowIso()` in file-session-service.ts), not `item.ts`. Mirror that here
		// rather than deriving from `item.ts`: callers like toggleTaskFavorite() reuse
		// an old HistoryItem whose `ts` predates this write, which would otherwise let
		// the cached ordering diverge from what's on disk until the cache TTL expires.
		this.updateCachedSessionRecord(sessionId, {
			prompt: item.task,
			metadata: writtenMetadata,
			updatedAt: new Date().toISOString(),
		})
	}

	async updateTaskHistoryItem(item: HistoryItem): Promise<void> {
		await this.updateSession(item.id, item)
	}

	private async deleteSession(sessionId: string): Promise<void> {
		const legacyTask = this.findLegacyTask(sessionId)
		try {
			await this.withHistoryHost(async (host) => {
				await host.delete(sessionId)
			})
		} catch (error) {
			if (!legacyTask) {
				throw error
			}
			Logger.warn(`[SdkTaskHistory] SDK session missing while deleting legacy task: ${sessionId}`, error)
		}
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
		return legacyItem ? { ...legacyItem, isLegacy: true } : undefined
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
		for (const item of tasksToDelete) {
			try {
				await this.deleteSession(item.sessionId)
				deletedCount += 1
			} catch (error) {
				Logger.error(`[SdkTaskHistory] Failed to delete task history item: ${item.sessionId}`, error)
			}
		}

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

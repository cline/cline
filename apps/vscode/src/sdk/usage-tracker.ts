import * as fs from "node:fs"
import * as path from "node:path"
import { resolveDataDirFromEnv } from "@shared/storage/storage-context"
import { Logger } from "@/shared/services/Logger"

/** One record per calendar day. Append-only; never deleted by task removal. */
export interface DailyUsageEvent {
	date: string // "2025-09-08" (UTC)
	tokensIn: number
	tokensOut: number
	cacheReads: number
	cacheWrites: number
	totalCost: number
	apiCalls: number
	byModel?: Record<string, ModelUsageEntry>
}

export interface ModelUsageEntry {
	tokensIn: number
	tokensOut: number
	cacheReads: number
	cacheWrites: number
	totalCost: number
	apiCalls: number
}

export interface UsageRecordInput {
	tokensIn: number
	tokensOut: number
	cacheReads?: number
	cacheWrites?: number
	totalCost?: number
	modelId?: string
}

/**
 * Tracks token usage in daily aggregate records, independent of task lifecycle.
 * Stored at ~/.cline/data/usage/daily-usage.json.
 * Writes are debounced (500ms) and atomic (write-then-rename).
 */
export class UsageTracker {
	private filePath: string
	private cache: DailyUsageEvent[] | undefined
	private writeTimer: NodeJS.Timeout | undefined

	constructor(dataDirOverride?: string) {
		const dataDir = dataDirOverride ?? resolveDataDirFromEnv()
		this.filePath = path.join(dataDir, "usage", "daily-usage.json")
	}

	/**
	 * Record usage for the current day. Called after every API turn completes.
	 * Debounces disk writes to avoid excessive I/O during rapid turns.
	 */
	recordUsage(input: UsageRecordInput): void {
		const date = new Date().toISOString().slice(0, 10)
		const events = this.load()

		let day = events.find((e) => e.date === date)
		if (!day) {
			day = {
				date,
				tokensIn: 0,
				tokensOut: 0,
				cacheReads: 0,
				cacheWrites: 0,
				totalCost: 0,
				apiCalls: 0,
				byModel: {},
			}
			events.push(day)
		}

		day.tokensIn += input.tokensIn
		day.tokensOut += input.tokensOut
		day.cacheReads += input.cacheReads ?? 0
		day.cacheWrites += input.cacheWrites ?? 0
		day.totalCost += input.totalCost ?? 0
		day.apiCalls++

		// Per-model breakdown
		const modelKey = input.modelId ?? "unknown"
		if (!day.byModel) {
			day.byModel = {}
		}
		const entry = day.byModel[modelKey] ?? {
			tokensIn: 0,
			tokensOut: 0,
			cacheReads: 0,
			cacheWrites: 0,
			totalCost: 0,
			apiCalls: 0,
		}
		entry.tokensIn += input.tokensIn
		entry.tokensOut += input.tokensOut
		entry.cacheReads += input.cacheReads ?? 0
		entry.cacheWrites += input.cacheWrites ?? 0
		entry.totalCost += input.totalCost ?? 0
		entry.apiCalls++
		day.byModel[modelKey] = entry

		this.cache = events
		this.scheduleWrite()
	}

	/** Read all daily usage events. Returns in-memory cache (always up-to-date). */
	getAll(): DailyUsageEvent[] {
		return this.load()
	}

	/** Flush any pending writes. Call on extension deactivation. */
	dispose(): void {
		if (this.writeTimer) {
			clearTimeout(this.writeTimer)
			this.writeTimer = undefined
		}
		this.flush()
	}

	private load(): DailyUsageEvent[] {
		if (this.cache) {
			return this.cache
		}
		try {
			const raw = fs.readFileSync(this.filePath, "utf-8")
			this.cache = JSON.parse(raw) as DailyUsageEvent[]
		} catch {
			this.cache = []
		}
		return this.cache
	}

	private scheduleWrite(): void {
		if (this.writeTimer) {
			return
		}
		this.writeTimer = setTimeout(() => {
			this.writeTimer = undefined
			this.flush()
		}, 500)
	}

	private flush(): void {
		if (!this.cache) {
			return
		}
		try {
			fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
			const sorted = [...this.cache].sort((a, b) => a.date.localeCompare(b.date))
			const tmp = `${this.filePath}.tmp`
			fs.writeFileSync(tmp, JSON.stringify(sorted), "utf-8")
			fs.renameSync(tmp, this.filePath)
		} catch (error) {
			Logger.error("[UsageTracker] Failed to write daily-usage.json:", error)
		}
	}
}

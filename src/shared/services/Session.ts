import { nanoid } from "nanoid"

export interface ToolCallRecord {
	name: string
	success?: boolean
	startTime: number
	lastUpdateTime: number
}

export interface ResourceUsage {
	// Memory (in bytes)
	heapUsed: number
	heapTotal: number
	external: number
	rss: number // Resident Set Size - total memory allocated for the process
	// CPU time (in milliseconds)
	userCpuMs: number
	systemCpuMs: number
}

export interface SessionStats {
	sessionId: string
	// Tool calls
	totalToolCalls: number
	successfulToolCalls: number
	failedToolCalls: number
	// Timing
	sessionStartTime: number
	apiTimeMs: number
	toolTimeMs: number
	// Resources
	resources: ResourceUsage
	peakMemoryBytes: number
}

/**
 * Session singleton for tracking current session statistics.
 * Used by CLI to display interaction summary.
 */
export class Session {
	private static instance: Session | null = null

	private sessionId: string
	private sessionStartTime: number
	private toolCalls: ToolCallRecord[] = []
	private apiTimeMs: number = 0
	private toolTimeMs: number = 0

	// Track in-flight operations
	private currentApiCallStart: number | null = null
	private inFlightToolCalls: Map<string, ToolCallRecord> = new Map()

	// Resource tracking
	private initialCpuUsage: NodeJS.CpuUsage
	private peakMemoryBytes: number = 0

	private constructor() {
		this.sessionId = nanoid(10)
		this.sessionStartTime = Date.now()
		this.initialCpuUsage = process.cpuUsage()
		this.updatePeakMemory()
	}

	/**
	 * Update peak memory if current usage is higher.
	 */
	private updatePeakMemory(): void {
		const memUsage = process.memoryUsage()
		if (memUsage.rss > this.peakMemoryBytes) {
			this.peakMemoryBytes = memUsage.rss
		}
	}

	/**
	 * Get current resource usage for this process.
	 */
	getResourceUsage(): ResourceUsage {
		this.updatePeakMemory()
		const memUsage = process.memoryUsage()
		const cpuUsage = process.cpuUsage(this.initialCpuUsage)

		return {
			heapUsed: memUsage.heapUsed,
			heapTotal: memUsage.heapTotal,
			external: memUsage.external,
			rss: memUsage.rss,
			// cpuUsage returns microseconds, convert to milliseconds
			userCpuMs: cpuUsage.user / 1000,
			systemCpuMs: cpuUsage.system / 1000,
		}
	}

	/**
	 * Get the singleton instance, creating it if necessary.
	 */
	static get(): Session {
		if (!Session.instance) {
			Session.instance = new Session()
		}
		return Session.instance
	}

	/**
	 * Reset the session (creates a new session with fresh ID and stats).
	 */
	static reset(): Session {
		Session.instance = new Session()
		return Session.instance
	}

	/**
	 * Get the current session ID.
	 */
	getSessionId(): string {
		return this.sessionId
	}

	/**
	 * Record the start of an API call.
	 */
	startApiCall(): void {
		this.currentApiCallStart = Date.now()
	}

	/**
	 * Record the end of an API call.
	 */
	endApiCall(): void {
		if (this.currentApiCallStart !== null) {
			this.apiTimeMs += Date.now() - this.currentApiCallStart
			this.currentApiCallStart = null
		}
	}

	/**
	 * Update a tool call - starts tracking if new, updates lastUpdateTime if existing.
	 * @param callId - Unique identifier for this tool call
	 * @param toolName - The name of the tool (required when starting a new call)
	 * @param success - Optional success status (only set when finalizing)
	 */
	updateToolCall(callId: string, toolName: string, success?: boolean): void {
		const now = Date.now()
		const existing = this.inFlightToolCalls.get(callId)

		if (existing) {
			// Update existing tool call
			existing.lastUpdateTime = now
			if (success !== undefined) {
				existing.success = success
			}
			return
		}

		// Start tracking new tool call
		this.inFlightToolCalls.set(callId, {
			name: toolName,
			startTime: now,
			lastUpdateTime: now,
		})
	}

	/**
	 * Add API time directly (useful when timing is tracked elsewhere).
	 */
	addApiTime(ms: number): void {
		this.apiTimeMs += ms
	}

	/**
	 * Finalize a request - moves all in-flight tool calls to completed and calculates durations.
	 * Call this when an API request completes to close out all pending tool calls.
	 */
	finalizeRequest(): void {
		for (const [callId, record] of this.inFlightToolCalls) {
			const duration = record.lastUpdateTime - record.startTime
			this.toolTimeMs += duration
			this.toolCalls.push({
				name: record.name,
				success: record.success,
				startTime: record.startTime,
				lastUpdateTime: record.lastUpdateTime,
			})
			this.inFlightToolCalls.delete(callId)
		}
	}

	/**
	 * Get all session statistics.
	 * Includes in-flight tool calls in the totals using their lastUpdateTime as end time.
	 */
	getStats(): SessionStats {
		this.finalizeRequest()

		// Combine completed and in-flight for totals
		const allToolCalls = this.toolCalls
		const successful = allToolCalls.filter((t) => t.success === true).length
		const failed = allToolCalls.filter((t) => t.success === false).length

		return {
			sessionId: this.sessionId,
			totalToolCalls: allToolCalls.length,
			successfulToolCalls: successful,
			failedToolCalls: failed,
			sessionStartTime: this.sessionStartTime,
			apiTimeMs: this.apiTimeMs,
			toolTimeMs: this.toolTimeMs,
			resources: this.getResourceUsage(),
			peakMemoryBytes: this.peakMemoryBytes,
		}
	}

	/**
	 * Get the wall time (time since session started) in milliseconds.
	 */
	getWallTimeMs(): number {
		return Date.now() - this.sessionStartTime
	}

	/**
	 * Get the session start time as a Date object.
	 */
	getStartTime(): Date {
		return new Date(this.sessionStartTime)
	}

	/**
	 * Get the current time (session end time) as a Date object.
	 */
	getEndTime(): Date {
		return new Date()
	}

	/**
	 * Format a timestamp for display (e.g., "2:34:56 PM").
	 */
	formatTime(date: Date): string {
		return date.toLocaleTimeString("en-US", {
			hour: "numeric",
			minute: "2-digit",
			second: "2-digit",
			hour12: true,
		})
	}

	/**
	 * Get the agent active time (API time + tool time) in milliseconds.
	 * Includes in-flight tool calls.
	 */
	getAgentActiveTimeMs(): number {
		const stats = this.getStats()
		return this.apiTimeMs + stats.toolTimeMs
	}

	/**
	 * Get the success rate as a percentage (0-100).
	 * Includes in-flight tool calls.
	 */
	getSuccessRate(): number {
		const stats = this.getStats()
		if (stats.totalToolCalls === 0) {
			return 0
		}
		return (stats.successfulToolCalls / stats.totalToolCalls) * 100
	}
}

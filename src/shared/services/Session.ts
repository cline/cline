import { nanoid } from "nanoid"

export interface ToolCallRecord {
	name: string
	success: boolean
	startTime: number
	endTime?: number
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
	private currentToolCallStart: number | null = null
	private currentToolName: string | null = null

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
	 * Record the start of a tool call.
	 */
	startToolCall(toolName: string): void {
		this.currentToolCallStart = Date.now()
		this.currentToolName = toolName
	}

	/**
	 * Record the end of a tool call with success/failure status.
	 */
	endToolCall(success: boolean): void {
		const endTime = Date.now()
		if (this.currentToolCallStart !== null && this.currentToolName !== null) {
			const duration = endTime - this.currentToolCallStart
			this.toolTimeMs += duration
			this.toolCalls.push({
				name: this.currentToolName,
				success,
				startTime: this.currentToolCallStart,
				endTime,
			})
			this.currentToolCallStart = null
			this.currentToolName = null
		}
	}

	/**
	 * Add API time directly (useful when timing is tracked elsewhere).
	 */
	addApiTime(ms: number): void {
		this.apiTimeMs += ms
	}

	/**
	 * Add tool time directly (useful when timing is tracked elsewhere).
	 */
	addToolTime(ms: number): void {
		this.toolTimeMs += ms
	}

	/**
	 * Record a completed tool call with known duration.
	 */
	recordToolCall(toolName: string, success: boolean, durationMs?: number): void {
		const now = Date.now()
		this.toolCalls.push({
			name: toolName,
			success,
			startTime: durationMs ? now - durationMs : now,
			endTime: now,
		})
		if (durationMs) {
			this.toolTimeMs += durationMs
		}
	}

	/**
	 * Get all session statistics.
	 */
	getStats(): SessionStats {
		const successful = this.toolCalls.filter((t) => t.success).length
		const failed = this.toolCalls.filter((t) => !t.success).length

		return {
			sessionId: this.sessionId,
			totalToolCalls: this.toolCalls.length,
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
	 */
	getAgentActiveTimeMs(): number {
		return this.apiTimeMs + this.toolTimeMs
	}

	/**
	 * Get the success rate as a percentage (0-100).
	 */
	getSuccessRate(): number {
		if (this.toolCalls.length === 0) {
			return 0
		}
		const successful = this.toolCalls.filter((t) => t.success).length
		return (successful / this.toolCalls.length) * 100
	}

	/**
	 * Get a formatted summary string for display.
	 */
	getFormattedSummary(): string {
		const stats = this.getStats()
		const wallTimeSeconds = (this.getWallTimeMs() / 1000).toFixed(1)
		const agentActiveSeconds = (this.getAgentActiveTimeMs() / 1000).toFixed(0)
		const apiTimeSeconds = (stats.apiTimeMs / 1000).toFixed(0)
		const toolTimeSeconds = (stats.toolTimeMs / 1000).toFixed(0)
		const agentActiveTotal = this.getAgentActiveTimeMs()
		const apiPercent = agentActiveTotal > 0 ? ((stats.apiTimeMs / agentActiveTotal) * 100).toFixed(1) : "0.0"
		const toolPercent = agentActiveTotal > 0 ? ((stats.toolTimeMs / agentActiveTotal) * 100).toFixed(1) : "0.0"

		return [
			"Interaction Summary",
			`Session ID:          ${stats.sessionId}`,
			`Tool Calls:          ${stats.totalToolCalls} ( ✓ ${stats.successfulToolCalls} ✗ ${stats.failedToolCalls} )`,
			`Success Rate:        ${this.getSuccessRate().toFixed(1)}%`,
			"",
			"Performance",
			`Wall Time:           ${wallTimeSeconds}s`,
			`Agent Active:        ${agentActiveSeconds}s`,
			`  » API Time:        ${apiTimeSeconds}s (${apiPercent}%)`,
			`  » Tool Time:       ${toolTimeSeconds}s (${toolPercent}%)`,
		].join("\n")
	}
}

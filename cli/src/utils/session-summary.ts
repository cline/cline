import { Session } from "@/shared/services/Session"

/**
 * Format milliseconds to a human-readable duration string
 */
function formatDuration(ms: number): string {
	if (ms < 1000) {
		return `${ms}ms`
	}
	const seconds = ms / 1000
	if (seconds < 60) {
		return `${seconds.toFixed(1)}s`
	}
	const minutes = Math.floor(seconds / 60)
	const remainingSeconds = seconds % 60
	return `${minutes}m ${remainingSeconds.toFixed(0)}s`
}

/**
 * Format a percentage value
 */
function formatPercent(value: number, total: number): string {
	if (total === 0) return "0.0%"
	return `${((value / total) * 100).toFixed(1)}%`
}

/**
 * Format bytes to a human-readable string (KB, MB, GB)
 */
function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes}B`
	}
	const kb = bytes / 1024
	if (kb < 1024) {
		return `${kb.toFixed(1)}KB`
	}
	const mb = kb / 1024
	if (mb < 1024) {
		return `${mb.toFixed(1)}MB`
	}
	const gb = mb / 1024
	return `${gb.toFixed(2)}GB`
}

// ANSI color codes
const GRAY = "\x1b[90m"
const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const BOLD = "\x1b[1m"
const RESET = "\x1b[0m"

/**
 * Print session summary to stdout using plain text (not Ink).
 * Used during shutdown when Ink may not have time to render.
 */
export function printSessionSummary(): void {
	const session = Session.get()
	const stats = session.getStats()
	const wallTimeMs = session.getWallTimeMs()
	const agentActiveMs = session.getAgentActiveTimeMs()

	// Don't show if session just started (less than 1 second)
	if (wallTimeMs < 1000) {
		return
	}

	const startTime = session.formatTime(session.getStartTime())
	const endTime = session.formatTime(session.getEndTime())
	const sessionTimeStr = `${startTime} → ${endTime}`

	const lines = [
		"",
		"┌─────────────────────────────────────────────────────────┐",
		`│ ${BOLD}Interaction Summary${RESET}                                      │`,
		"├─────────────────────────────────────────────────────────┤",
		`│ ${GRAY}Session ID:${RESET}    ${stats.sessionId.padEnd(42)}│`,
		`│ ${GRAY}Session Time:${RESET}  ${sessionTimeStr.padEnd(42)}│`,
		`│ ${GRAY}Tool Calls:${RESET}    ${stats.totalToolCalls} ( ${GREEN}✓ ${stats.successfulToolCalls}${RESET} ${RED}✗ ${stats.failedToolCalls}${RESET} )`.padEnd(
			70,
		) + "│",
		`│ ${GRAY}Success Rate:${RESET}  ${session.getSuccessRate().toFixed(1)}%`.padEnd(60) + "│",
		"├─────────────────────────────────────────────────────────┤",
		`│ ${BOLD}Performance${RESET}                                              │`,
		`│ ${GRAY}Wall Time:${RESET}     ${formatDuration(wallTimeMs).padEnd(42)}│`,
		`│ ${GRAY}Agent Active:${RESET}  ${formatDuration(agentActiveMs).padEnd(42)}│`,
		`│ ${GRAY} » API Time:${RESET}   ${formatDuration(stats.apiTimeMs)} ${GRAY}(${formatPercent(stats.apiTimeMs, agentActiveMs)})${RESET}`.padEnd(
			60,
		) + "│",
		`│ ${GRAY} » Tool Time:${RESET}  ${formatDuration(stats.toolTimeMs)} ${GRAY}(${formatPercent(stats.toolTimeMs, agentActiveMs)})${RESET}`.padEnd(
			60,
		) + "│",
		"├─────────────────────────────────────────────────────────┤",
		`│ ${BOLD}Resources${RESET}                                                │`,
		`│ ${GRAY}Memory (RSS):${RESET}  ${formatBytes(stats.resources.rss).padEnd(42)}│`,
		`│ ${GRAY}Peak Memory:${RESET}   ${formatBytes(stats.peakMemoryBytes).padEnd(42)}│`,
		`│ ${GRAY}Heap Used:${RESET}     ${formatBytes(stats.resources.heapUsed)} ${GRAY}/ ${formatBytes(stats.resources.heapTotal)}${RESET}`.padEnd(
			60,
		) + "│",
		`│ ${GRAY}CPU Time:${RESET}      ${formatDuration(stats.resources.userCpuMs + stats.resources.systemCpuMs)} ${GRAY}(user: ${formatDuration(stats.resources.userCpuMs)}, sys: ${formatDuration(stats.resources.systemCpuMs)})${RESET}`.padEnd(
			60,
		) + "│",
		"└─────────────────────────────────────────────────────────┘",
		"",
	]

	process.stdout.write(lines.join("\n"))
}

import { Box, Text } from "ink"
import React from "react"
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

interface SessionSummaryProps {
	/** Optional width constraint */
	width?: number
}

/**
 * Displays session statistics when the CLI exits.
 * Shows tool call counts, success rate, and timing breakdown.
 */
export const SessionSummary: React.FC<SessionSummaryProps> = ({ width }) => {
	const session = Session.get()
	const stats = session.getStats()
	const wallTimeMs = session.getWallTimeMs()
	const agentActiveMs = session.getAgentActiveTimeMs()

	// Don't show if session just started (less than 1 second)
	if (wallTimeMs < 1000) {
		return null
	}

	return (
		<Box borderColor="gray" borderStyle="single" flexDirection="column" paddingX={1} width={width}>
			{/* Header */}
			<Box marginBottom={1}>
				<Text bold>Interaction Summary</Text>
			</Box>

			{/* Session ID */}
			<Box>
				<Box width={20}>
					<Text color="gray">Session ID:</Text>
				</Box>
				<Text>{stats.sessionId}</Text>
			</Box>

			{/* Session Time */}
			<Box>
				<Box width={20}>
					<Text color="gray">Session Time:</Text>
				</Box>
				<Text>
					{session.formatTime(session.getStartTime())} → {session.formatTime(session.getEndTime())}
				</Text>
			</Box>

			{/* Tool Calls */}
			<Box>
				<Box width={20}>
					<Text color="gray">Tool Calls:</Text>
				</Box>
				<Text>{stats.totalToolCalls}</Text>
			</Box>

			{/* Performance Header */}
			<Box marginBottom={0}>
				<Text bold>Performance</Text>
			</Box>

			{/* Wall Time */}
			<Box>
				<Box width={20}>
					<Text color="gray">Wall Time:</Text>
				</Box>
				<Text>{formatDuration(wallTimeMs)}</Text>
			</Box>

			{/* Agent Active */}
			<Box>
				<Box width={20}>
					<Text color="gray">Agent Active:</Text>
				</Box>
				<Text>{formatDuration(agentActiveMs)}</Text>
			</Box>

			{/* API Time */}
			<Box>
				<Box width={20}>
					<Text color="gray"> » API Time:</Text>
				</Box>
				<Text>
					{formatDuration(stats.apiTimeMs)} <Text color="gray">({formatPercent(stats.apiTimeMs, agentActiveMs)})</Text>
				</Text>
			</Box>

			{/* Tool Time */}
			<Box marginBottom={1}>
				<Box width={20}>
					<Text color="gray"> » Tool Time:</Text>
				</Box>
				<Text>
					{formatDuration(stats.toolTimeMs)}{" "}
					<Text color="gray">({formatPercent(stats.toolTimeMs, agentActiveMs)})</Text>
				</Text>
			</Box>

			{/* Resources Header */}
			<Box marginBottom={0}>
				<Text bold>Resources</Text>
			</Box>

			{/* Memory Usage */}
			<Box>
				<Box width={20}>
					<Text color="gray">Memory (RSS):</Text>
				</Box>
				<Text>{formatBytes(stats.resources.rss)}</Text>
			</Box>

			{/* Peak Memory */}
			<Box>
				<Box width={20}>
					<Text color="gray">Peak Memory:</Text>
				</Box>
				<Text>{formatBytes(stats.peakMemoryBytes)}</Text>
			</Box>

			{/* Heap Usage */}
			<Box>
				<Box width={20}>
					<Text color="gray">Heap Used:</Text>
				</Box>
				<Text>
					{formatBytes(stats.resources.heapUsed)} <Text color="gray">/ {formatBytes(stats.resources.heapTotal)}</Text>
				</Text>
			</Box>

			{/* CPU Time */}
			<Box>
				<Box width={20}>
					<Text color="gray">CPU Time:</Text>
				</Box>
				<Text>
					{formatDuration(stats.resources.userCpuMs + stats.resources.systemCpuMs)}{" "}
					<Text color="gray">
						(user: {formatDuration(stats.resources.userCpuMs)}, sys: {formatDuration(stats.resources.systemCpuMs)})
					</Text>
				</Text>
			</Box>
		</Box>
	)
}

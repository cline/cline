export const MAX_PENDING_MCP_NOTIFICATIONS = 200
export const MAX_MCP_SERVER_ERROR_CHARS = 32 * 1024
const MCP_ERROR_TRUNCATION_MARKER = "\n...[older MCP errors truncated]...\n"

export interface PendingMcpNotification {
	serverName: string
	level: string
	message: string
	timestamp: number
}

export interface PendingMcpNotificationEnqueueResult {
	queue: PendingMcpNotification[]
	droppedCount: number
}

export interface BoundedMcpErrorResult {
	value: string
	truncated: boolean
	originalLength: number
	retainedLength: number
}

export function enqueuePendingMcpNotification(
	queue: PendingMcpNotification[],
	notification: PendingMcpNotification,
	maxNotifications: number = MAX_PENDING_MCP_NOTIFICATIONS,
): PendingMcpNotificationEnqueueResult {
	const nextQueue = [...queue, notification]
	if (nextQueue.length <= maxNotifications) {
		return {
			queue: nextQueue,
			droppedCount: 0,
		}
	}
	const droppedCount = nextQueue.length - maxNotifications
	return {
		queue: nextQueue.slice(nextQueue.length - maxNotifications),
		droppedCount,
	}
}

export function appendBoundedMcpError(
	existingError: string | undefined,
	newError: string,
	maxChars: number = MAX_MCP_SERVER_ERROR_CHARS,
): BoundedMcpErrorResult {
	const combined = existingError ? `${existingError}\n${newError}` : newError
	if (combined.length <= maxChars) {
		return {
			value: combined,
			truncated: false,
			originalLength: combined.length,
			retainedLength: combined.length,
		}
	}

	const tailBudget = Math.max(0, maxChars - MCP_ERROR_TRUNCATION_MARKER.length)
	const value = `${MCP_ERROR_TRUNCATION_MARKER}${combined.slice(-tailBudget)}`
	return {
		value,
		truncated: true,
		originalLength: combined.length,
		retainedLength: value.length,
	}
}

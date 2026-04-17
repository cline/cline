export const MAX_PENDING_MCP_NOTIFICATIONS = 200
export const MAX_MCP_SERVER_ERROR_CHARS = 32 * 1024
const MCP_ERROR_TRUNCATION_MARKER = "\n...[older MCP errors truncated]...\n"

export interface PendingMcpNotification {
	serverName: string
	level: string
	message: string
	timestamp: number
}

export function enqueuePendingMcpNotification(
	queue: PendingMcpNotification[],
	notification: PendingMcpNotification,
	maxNotifications: number = MAX_PENDING_MCP_NOTIFICATIONS,
): PendingMcpNotification[] {
	const nextQueue = [...queue, notification]
	if (nextQueue.length <= maxNotifications) {
		return nextQueue
	}
	return nextQueue.slice(nextQueue.length - maxNotifications)
}

export function appendBoundedMcpError(
	existingError: string | undefined,
	newError: string,
	maxChars: number = MAX_MCP_SERVER_ERROR_CHARS,
): string {
	const combined = existingError ? `${existingError}\n${newError}` : newError
	if (combined.length <= maxChars) {
		return combined
	}

	const tailBudget = Math.max(0, maxChars - MCP_ERROR_TRUNCATION_MARKER.length)
	return `${MCP_ERROR_TRUNCATION_MARKER}${combined.slice(-tailBudget)}`
}

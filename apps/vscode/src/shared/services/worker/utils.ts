/**
 * Parse task timestamp from taskId.
 * Task IDs are generated using Date.now().toString().
 */
export function getTaskTimestamp(taskId: string): number | undefined {
	const timestamp = parseInt(taskId, 10)
	return Number.isNaN(timestamp) ? undefined : timestamp
}

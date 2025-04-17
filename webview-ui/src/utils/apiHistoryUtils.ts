import { ApiRequestHistoryEntry } from "@shared/ClineAccount"

/**
 * Represents a summary of API requests for a single task.
 */
export type TaskSummaryEntry = {
	taskId: string
	firstTimestamp: number // Timestamp of the first request for this task
	taskSnippet: string // First 50 chars of the task prompt
	totalRequests: number
	totalTokens: number // Sum of input + output tokens for all requests in the task
	totalCost: number // Sum of costs for all requests in the task
}

/**
 * Calculates task summaries from the raw API request history.
 * @param history - The array of API request history entries.
 * @returns An array of TaskSummaryEntry objects, sorted by firstTimestamp descending.
 */
export const calculateTaskSummaries = (history: ApiRequestHistoryEntry[]): TaskSummaryEntry[] => {
	if (!history || history.length === 0) {
		return []
	}

	const summaryMap = new Map<string, TaskSummaryEntry>()

	// Sort history by timestamp ascending to get the first timestamp easily
	const sortedHistory = [...history].sort((a, b) => a.timestamp - b.timestamp)

	sortedHistory.forEach((entry) => {
		if (!summaryMap.has(entry.taskId)) {
			summaryMap.set(entry.taskId, {
				taskId: entry.taskId,
				firstTimestamp: entry.timestamp, // First entry in sorted list has the earliest timestamp
				taskSnippet: entry.taskSnippet,
				totalRequests: 0,
				totalTokens: 0,
				totalCost: 0,
			})
		}

		const taskSummary = summaryMap.get(entry.taskId)!
		taskSummary.totalRequests += 1
		taskSummary.totalTokens += entry.inputTokens + entry.outputTokens
		taskSummary.totalCost += entry.cost || 0
	})

	// Return summaries sorted by timestamp descending (most recent first)
	return Array.from(summaryMap.values()).sort((a, b) => b.firstTimestamp - a.firstTimestamp)
}

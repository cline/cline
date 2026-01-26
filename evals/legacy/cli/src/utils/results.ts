import { v4 as uuidv4 } from "uuid"
import { ResultsDatabase } from "../db"
import { Task } from "../adapters/types"

/**
 * Store task result in the database
 * @param runId The run ID
 * @param task The task that was executed
 * @param result The result from the test server
 * @param verification The verification result
 */
export async function storeTaskResult(runId: string, task: Task, result: any, verification: any): Promise<void> {
	const db = new ResultsDatabase()
	const taskId = uuidv4()

	try {
		// Extract metrics from the result
		const { metrics } = result
		const totalToolCalls = metrics?.totalToolCalls || 0
		const totalToolFailures = metrics?.totalToolFailures || 0

		// Create task with tool metrics
		db.createTask(taskId, runId, task.id)
		db.completeTask(taskId, verification.success, totalToolCalls, totalToolFailures)

		// Store metrics
		if (metrics) {
			// Store token metrics
			if (metrics.tokensIn) db.addMetric(taskId, "tokensIn", metrics.tokensIn)
			if (metrics.tokensOut) db.addMetric(taskId, "tokensOut", metrics.tokensOut)
			if (metrics.cost) db.addMetric(taskId, "cost", metrics.cost)
			if (metrics.duration) db.addMetric(taskId, "duration", metrics.duration)

			// Store tool call metrics
			if (metrics.toolCalls) {
				for (const [toolName, callCount] of Object.entries(metrics.toolCalls)) {
					const failureCount = metrics.toolFailures?.[toolName] || 0
					db.addToolCall(taskId, toolName, callCount as number, failureCount)
				}
			}
		}

		// Store verification metrics
		if (verification.metrics) {
			for (const [key, value] of Object.entries(verification.metrics)) {
				if (typeof value === "number") {
					db.addMetric(taskId, key, value)
				}
			}
		}

		// Store file changes
		if (result.files) {
			// Store created files
			if (result.files.created) {
				for (const file of result.files.created) {
					db.addFile(taskId, file, "created")
				}
			}

			// Store modified files
			if (result.files.modified) {
				for (const file of result.files.modified) {
					db.addFile(taskId, file, "modified")
				}
			}

			// Store deleted files
			if (result.files.deleted) {
				for (const file of result.files.deleted) {
					db.addFile(taskId, file, "deleted")
				}
			}
		}
	} finally {
		// Close the database connection
		db.close()
	}
}

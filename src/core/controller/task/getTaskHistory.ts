import { Controller } from ".."
import { GetTaskHistoryRequest, TaskHistoryArray } from "../../../shared/proto/task"
import { getGlobalState } from "../../storage/state"

/**
 * Gets filtered task history
 * @param controller The controller instance
 * @param request Filter parameters for task history
 * @returns TaskHistoryArray with filtered task list
 */
export async function getTaskHistory(controller: Controller, request: GetTaskHistoryRequest): Promise<TaskHistoryArray> {
	try {
		const { favoritesOnly, searchQuery, sortBy } = request

		// Get task history from global state
		const taskHistory = ((await getGlobalState(controller.context, "taskHistory")) as any[]) || []

		// Apply filters
		let filteredTasks = taskHistory.filter((item) => {
			// Basic filter: must have timestamp and task content
			const hasRequiredFields = item.ts && item.task

			// Apply favorites filter if requested
			if (favoritesOnly && hasRequiredFields) {
				return item.isFavorited === true
			}

			return hasRequiredFields
		})

		// Apply search if provided
		if (searchQuery) {
			// Simple search implementation
			const query = searchQuery.toLowerCase()
			filteredTasks = filteredTasks.filter((item) => item.task.toLowerCase().includes(query))
		}

		// Calculate total count before sorting
		const totalCount = filteredTasks.length

		// Apply sorting
		if (sortBy) {
			filteredTasks.sort((a, b) => {
				switch (sortBy) {
					case "oldest":
						return a.ts - b.ts
					case "mostExpensive":
						return (b.totalCost || 0) - (a.totalCost || 0)
					case "mostTokens":
						return (
							(b.tokensIn || 0) +
							(b.tokensOut || 0) +
							(b.cacheWrites || 0) +
							(b.cacheReads || 0) -
							((a.tokensIn || 0) + (a.tokensOut || 0) + (a.cacheWrites || 0) + (a.cacheReads || 0))
						)
					case "newest":
					default:
						return b.ts - a.ts
				}
			})
		} else {
			// Default sort by newest
			filteredTasks.sort((a, b) => b.ts - a.ts)
		}

		// Map to response format
		const tasks = filteredTasks.map((item) => ({
			id: item.id,
			task: item.task,
			ts: item.ts,
			isFavorited: item.isFavorited || false,
			size: item.size || 0,
			totalCost: item.totalCost || 0,
			tokensIn: item.tokensIn || 0,
			tokensOut: item.tokensOut || 0,
			cacheWrites: item.cacheWrites || 0,
			cacheReads: item.cacheReads || 0,
		}))

		return {
			tasks,
			totalCount,
		}
	} catch (error) {
		console.error("Error in getTaskHistory:", error)
		throw error
	}
}

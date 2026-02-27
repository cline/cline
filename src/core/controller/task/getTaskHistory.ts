import { GetTaskHistoryRequest, TaskHistoryArray } from "@shared/proto/cline/task"
import { Logger } from "@/shared/services/Logger"
import { arePathsEqual, getWorkspacePath } from "../../../utils/path"
import { Controller } from ".."

/**
 * Gets filtered task history
 * @param controller The controller instance
 * @param request Filter parameters for task history
 * @returns TaskHistoryArray with filtered task list
 */
export async function getTaskHistory(controller: Controller, request: GetTaskHistoryRequest): Promise<TaskHistoryArray> {
	try {
		const { favoritesOnly, currentWorkspaceOnly, searchQuery, sortBy } = request

		// Get task history from global state
		const taskHistory = controller.stateManager.getGlobalStateKey("taskHistory")
		// Ensure workspace manager is initialized for workspace path detection
		const wm = await controller.ensureWorkspaceManager()
		const workspacePath = wm?.getPrimaryRoot()?.path || (await getWorkspacePath().catch(() => ""))

		const getWorkspaceName = (item: (typeof taskHistory)[number]): string => {
			const p = item.cwdOnTaskInitialization || item.shadowGitConfigWorkTree
			if (!p) return ""
			const segments = p.replace(/\\/g, "/").split("/").filter(Boolean)
			return segments[segments.length - 1] || ""
		}

		const isTaskInCurrentWorkspace = (item: (typeof taskHistory)[number]) => {
			if (item.cwdOnTaskInitialization && arePathsEqual(item.cwdOnTaskInitialization, workspacePath)) {
				return true
			}

			if (item.shadowGitConfigWorkTree && arePathsEqual(item.shadowGitConfigWorkTree, workspacePath)) {
				return true
			}

			return false
		}

		// Apply filters
		let filteredTasks = taskHistory.filter((item) => {
			// Basic filter: must have timestamp and task content
			const hasRequiredFields = item.ts && item.task
			if (!hasRequiredFields) {
				return false
			}

			// Apply favorites filter if requested
			if (favoritesOnly && !item.isFavorited) {
				return false
			}

			// Apply current workspace filter if requested
			if (currentWorkspaceOnly) {
				if (!isTaskInCurrentWorkspace(item)) {
					return false
				}
			}

			return true
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
			modelId: item.modelId || "",
			isCurrentWorkspace: isTaskInCurrentWorkspace(item),
			workspaceName: getWorkspaceName(item),
		}))

		return TaskHistoryArray.create({
			tasks,
			totalCount,
		})
	} catch (error) {
		Logger.error("Error in getTaskHistory:", error)
		throw error
	}
}

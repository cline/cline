import { GetTaskHistoryRequest, TaskHistoryArray } from "@shared/proto/cline/task"
import { arePathsEqual, getWorkspacePath } from "../../../utils/path"
import { readTaskHistoryFromState } from "../../storage/disk"
import { Controller } from ".."

/**
 * Gets filtered task history
 * @param controller The controller instance
 * @param request Filter parameters for task history
 * @returns TaskHistoryArray with filtered task list
 */
export async function getTaskHistory(controller: Controller, request: GetTaskHistoryRequest): Promise<TaskHistoryArray> {
	try {
		const { favoritesOnly, currentWorkspaceOnly, searchQuery, sortBy, filterByWorkspaceId } = request

		// Get task history - from workspace state if filtering by current workspace,
		// otherwise from global aggregated history to support cross-workspace view
		let taskHistory
		const workspacePath = await getWorkspacePath()

		// Read from global task history (single source of truth)
		const allTasks = await readTaskHistoryFromState()

		if (currentWorkspaceOnly) {
			// Only show current workspace tasks
			taskHistory = allTasks.filter((item) => {
				if (item.workspaceIds && item.workspaceIds.length > 0) {
					return item.workspaceIds.some((wsPath) => arePathsEqual(wsPath, workspacePath))
				}
				// Legacy tasks - check old fields
				const taskWorkspacePath = item.cwdOnTaskInitialization || item.shadowGitConfigWorkTree
				return taskWorkspacePath ? arePathsEqual(taskWorkspacePath, workspacePath) : false
			})
		} else if (filterByWorkspaceId) {
			// Filter by specific workspace ID
			taskHistory = allTasks.filter((item) => {
				if (!item.workspaceIds || item.workspaceIds.length === 0) {
					// Legacy tasks without workspaceIds - check old fields
					return (
						(item.cwdOnTaskInitialization && arePathsEqual(item.cwdOnTaskInitialization, filterByWorkspaceId)) ||
						(item.shadowGitConfigWorkTree && arePathsEqual(item.shadowGitConfigWorkTree, filterByWorkspaceId))
					)
				}
				// Check if workspace is in task's workspaceIds
				return item.workspaceIds.some((wsPath) => arePathsEqual(wsPath, filterByWorkspaceId))
			})
		} else {
			// Show all workspaces
			taskHistory = allTasks
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

			// Note: currentWorkspaceOnly filtering is already handled in the initial fetch logic above
			// No need for redundant filtering here

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

		// Get workspace metadata for display names
		const workspaceMetadata = controller.stateManager.getGlobalStateKey("workspaceMetadata") || {}

		// Map to response format
		const tasks = filteredTasks.map((item) => {
			// Determine workspace IDs (use legacy fields if workspaceIds not present)
			let workspaceIds = item.workspaceIds || []
			if (workspaceIds.length === 0 && (item.cwdOnTaskInitialization || item.shadowGitConfigWorkTree)) {
				// Legacy task - use the path from cwdOnTaskInitialization or shadowGitConfigWorkTree
				const legacyPath = item.cwdOnTaskInitialization || item.shadowGitConfigWorkTree
				if (legacyPath) {
					workspaceIds = [legacyPath]
				}
			}

			// Get primary workspace name (first workspace in list)
			let workspaceName = ""
			if (workspaceIds.length > 0) {
				const primaryWorkspacePath = workspaceIds[0]
				const metadata = workspaceMetadata[primaryWorkspacePath]
				workspaceName = metadata?.name || primaryWorkspacePath.split("/").pop() || ""
			}

			return {
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
				workspaceIds,
				workspaceName,
			}
		})

		return TaskHistoryArray.create({
			tasks,
			totalCount,
		})
	} catch (error) {
		console.error("Error in getTaskHistory:", error)
		throw error
	}
}

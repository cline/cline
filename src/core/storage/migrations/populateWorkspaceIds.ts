import { readTaskHistoryFromState, writeTaskHistoryToState } from "../disk"

export async function populateWorkspaceIds(): Promise<void> {
	console.log("[Migration] Starting populateWorkspaceIds migration...")

	const taskHistory = await readTaskHistoryFromState()
	let migratedCount = 0
	let skippedCount = 0
	let noWorkspacePathCount = 0

	console.log(`[Migration] Total tasks to process: ${taskHistory.length}`)

	const updatedHistory = taskHistory.map((task) => {
		// Skip if already has workspaceIds
		if (task.workspaceIds && task.workspaceIds.length > 0) {
			skippedCount++
			return task
		}

		// Try to populate from legacy fields
		const workspacePath = task.cwdOnTaskInitialization || task.shadowGitConfigWorkTree
		if (workspacePath) {
			migratedCount++
			console.log(`[Migration] Migrating task ${task.id} with workspace: ${workspacePath}`)
			return { ...task, workspaceIds: [workspacePath] }
		}

		// No workspace path available
		noWorkspacePathCount++
		console.warn(`[Migration] Task ${task.id} has no workspace path to migrate from`)
		return task
	})

	await writeTaskHistoryToState(updatedHistory)

	console.log(`[Migration] populateWorkspaceIds complete:`, {
		totalTasks: taskHistory.length,
		migratedCount,
		skippedCount,
		noWorkspacePathCount,
		successRate: `${((migratedCount / taskHistory.length) * 100).toFixed(1)}%`,
	})
}

import { readTaskHistoryFromState, writeTaskHistoryToState } from "../disk"

export async function populateWorkspaceIds(): Promise<void> {
	const taskHistory = await readTaskHistoryFromState()
	let migratedCount = 0
	let skippedCount = 0

	const updatedHistory = taskHistory.map((task) => {
		if (task.workspaceIds && task.workspaceIds.length > 0) {
			skippedCount++
			return task
		}

		const workspacePath = task.cwdOnTaskInitialization || task.shadowGitConfigWorkTree
		if (workspacePath) {
			migratedCount++
			return { ...task, workspaceIds: [workspacePath] }
		}

		skippedCount++
		return task
	})

	await writeTaskHistoryToState(updatedHistory)
	console.log(`[Migration] Populated workspaceIds: ${migratedCount} migrated, ${skippedCount} skipped`)
}

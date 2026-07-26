import { EmptyRequest } from "@shared/proto/cline/common"
import { WorktreeDefaults } from "@shared/proto/cline/worktree"
import { getGitRootPath } from "@utils/git-worktree"
import { getWorkspacePath } from "@utils/path"
import { getManagedWorktreeRoot } from "@utils/worktree-safety"
import path from "path"
import { Controller } from ".."

/**
 * Generates a random suffix for worktree names
 * Returns a 5-character alphanumeric string
 */
function generateRandomSuffix(): string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	let result = ""
	for (let i = 0; i < 5; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length))
	}
	return result
}

/**
 * Gets suggested defaults for creating a new worktree
 * @param controller The controller instance
 * @param request Empty request
 * @returns WorktreeDefaults with suggested branch name and path
 */
export async function getWorktreeDefaults(_controller: Controller, _request: EmptyRequest): Promise<WorktreeDefaults> {
	const suffix = generateRandomSuffix()

	// Generate suggested branch name
	const suggestedBranch = `worktree/cline-${suffix}`

	const cwd = await getWorkspacePath()
	const repositoryRoot = cwd ? ((await getGitRootPath(cwd)) ?? cwd) : ""
	const managedRoot = repositoryRoot ? getManagedWorktreeRoot(repositoryRoot) : ""

	// Get project name from workspace path
	let projectName = "project"
	if (cwd) {
		projectName = path.basename(cwd)
	}

	const suggestedPath = path.join(managedRoot, `${projectName}-${suffix}`)

	return WorktreeDefaults.create({
		suggestedBranch,
		suggestedPath,
		managedRoot,
		repositoryRoot,
	})
}

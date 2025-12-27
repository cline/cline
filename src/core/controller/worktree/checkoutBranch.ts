import { CheckoutBranchRequest, WorktreeResult } from "@shared/proto/cline/worktree"
import { getWorkspacePath } from "@utils/path"
import { exec } from "child_process"
import { promisify } from "util"
import { Controller } from ".."

const execAsync = promisify(exec)

/**
 * Checks out a branch in the current worktree (git checkout)
 * @param controller The controller instance
 * @param request The checkout branch request containing the branch name
 * @returns WorktreeResult indicating success or failure
 */
export async function checkoutBranch(_controller: Controller, request: CheckoutBranchRequest): Promise<WorktreeResult> {
	const cwd = await getWorkspacePath()
	if (!cwd) {
		return WorktreeResult.create({
			success: false,
			message: "No workspace folder found",
		})
	}

	const { branch } = request

	if (!branch) {
		return WorktreeResult.create({
			success: false,
			message: "Branch name is required",
		})
	}

	try {
		await execAsync(`git checkout "${branch}"`, { cwd })

		return WorktreeResult.create({
			success: true,
			message: `Switched to branch '${branch}'`,
		})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		return WorktreeResult.create({
			success: false,
			message: `Failed to checkout branch: ${errorMessage}`,
		})
	}
}

import path from "node:path"
import { listWorktrees } from "@utils/git-worktree"
import { getWorkspacePath } from "@utils/path"

export async function validateTeamWorktreeAssignment(worktreePath: string | undefined): Promise<void> {
	if (!worktreePath) return
	const cwd = await getWorkspacePath()
	if (!cwd) {
		throw new Error("Cannot assign a worktree without an open workspace")
	}
	const normalize = (value: string) => {
		const resolved = path.resolve(value)
		return process.platform === "win32" ? resolved.toLowerCase() : resolved
	}
	const { worktrees } = await listWorktrees(cwd)
	if (!worktrees.some((worktree) => normalize(worktree.path) === normalize(worktreePath))) {
		throw new Error("The assigned path is not a recognized worktree of the current repository")
	}
}

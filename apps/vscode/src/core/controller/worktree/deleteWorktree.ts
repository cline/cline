import { DeleteWorktreeRequest, WorktreeResult } from "@shared/proto/cline/worktree"
import { Controller } from ".."

export async function deleteWorktree(_controller: Controller, _request: DeleteWorktreeRequest): Promise<WorktreeResult> {
	return WorktreeResult.create({})
}

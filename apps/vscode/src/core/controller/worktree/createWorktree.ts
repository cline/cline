import { CreateWorktreeRequest, WorktreeResult } from "@shared/proto/cline/worktree"
import { Controller } from ".."

export async function createWorktree(_controller: Controller, _request: CreateWorktreeRequest): Promise<WorktreeResult> {
	return WorktreeResult.create({})
}

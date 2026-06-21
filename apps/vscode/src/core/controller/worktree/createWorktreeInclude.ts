import { CreateWorktreeIncludeRequest, WorktreeResult } from "@shared/proto/cline/worktree"
import { Controller } from ".."

export async function createWorktreeInclude(
	_controller: Controller,
	_request: CreateWorktreeIncludeRequest,
): Promise<WorktreeResult> {
	return WorktreeResult.create({})
}

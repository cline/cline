import { SwitchWorktreeRequest, WorktreeResult } from "@shared/proto/cline/worktree"
import { Controller } from ".."

export async function switchWorktree(_controller: Controller, _request: SwitchWorktreeRequest): Promise<WorktreeResult> {
	return WorktreeResult.create({})
}

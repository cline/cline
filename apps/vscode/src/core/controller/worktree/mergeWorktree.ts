import { MergeWorktreeRequest, MergeWorktreeResult } from "@shared/proto/cline/worktree"
import { Controller } from ".."

export async function mergeWorktree(_controller: Controller, _request: MergeWorktreeRequest): Promise<MergeWorktreeResult> {
	return MergeWorktreeResult.create({})
}

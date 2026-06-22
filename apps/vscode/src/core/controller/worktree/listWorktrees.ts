import { EmptyRequest } from "@shared/proto/cline/common"
import { WorktreeList } from "@shared/proto/cline/worktree"
import { Controller } from ".."

export async function listWorktrees(_controller: Controller, _request: EmptyRequest): Promise<WorktreeList> {
	return WorktreeList.create({})
}

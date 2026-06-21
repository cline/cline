import { EmptyRequest } from "@shared/proto/cline/common"
import { WorktreeIncludeStatus } from "@shared/proto/cline/worktree"
import { Controller } from ".."

export async function getWorktreeIncludeStatus(_controller: Controller, _request: EmptyRequest): Promise<WorktreeIncludeStatus> {
	return WorktreeIncludeStatus.create({})
}

import { EmptyRequest } from "@shared/proto/cline/common"
import { BranchList } from "@shared/proto/cline/worktree"
import { Controller } from ".."

export async function getAvailableBranches(_controller: Controller, _request: EmptyRequest): Promise<BranchList> {
	return BranchList.create({})
}

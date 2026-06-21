import { CheckoutBranchRequest, WorktreeResult } from "@shared/proto/cline/worktree"
import { Controller } from ".."

export async function checkoutBranch(_controller: Controller, _request: CheckoutBranchRequest): Promise<WorktreeResult> {
	return WorktreeResult.create({})
}

import { EmptyRequest } from "@shared/proto/cline/common"
import { WorktreeDefaults } from "@shared/proto/cline/worktree"
import { Controller } from ".."

export async function getWorktreeDefaults(_controller: Controller, _request: EmptyRequest): Promise<WorktreeDefaults> {
	return WorktreeDefaults.create({})
}

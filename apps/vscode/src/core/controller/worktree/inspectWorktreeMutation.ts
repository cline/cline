import { InspectWorktreeMutationRequest, WorktreeMutationInspection } from "@shared/proto/bedrock_coder/worktree"
import { getWorkspacePath } from "@utils/path"
import { inspectWorktreeMutation as inspectMutation } from "@utils/worktree-safety"
import { Controller } from ".."

export async function inspectWorktreeMutation(
	_controller: Controller,
	request: InspectWorktreeMutationRequest,
): Promise<WorktreeMutationInspection> {
	const cwd = await getWorkspacePath()
	if (!cwd) {
		return WorktreeMutationInspection.create({
			allowed: false,
			reason: "No workspace folder open",
			operation: request.operation,
			worktreePath: request.worktreePath,
		})
	}

	if (!["create", "delete", "merge"].includes(request.operation)) {
		return WorktreeMutationInspection.create({
			allowed: false,
			reason: `Unsupported worktree operation: ${request.operation}`,
			operation: request.operation,
			worktreePath: request.worktreePath,
		})
	}

	const inspection = await inspectMutation(cwd, {
		operation: request.operation as "create" | "delete" | "merge",
		worktreePath: request.worktreePath,
		branch: request.branch,
		baseBranch: request.baseBranch,
		targetBranch: request.targetBranch,
		allowDirty: request.allowDirty,
		affectedTaskId: request.affectedTaskId,
		affectedAgentId: request.affectedAgentId,
		createNewBranch: request.createNewBranch,
	})

	return WorktreeMutationInspection.create({
		...inspection,
	})
}

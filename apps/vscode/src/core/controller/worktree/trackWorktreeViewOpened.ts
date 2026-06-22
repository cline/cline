import { Empty } from "@shared/proto/cline/common"
import { TrackWorktreeViewOpenedRequest } from "@shared/proto/cline/worktree"
import { Controller } from ".."

export async function trackWorktreeViewOpened(_controller: Controller, _request: TrackWorktreeViewOpenedRequest): Promise<Empty> {
	return Empty.create({})
}

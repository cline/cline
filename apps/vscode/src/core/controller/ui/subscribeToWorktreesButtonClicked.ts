import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

/**
 * Subscribe to worktrees button clicked events
 */
export async function subscribeToWorktreesButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	_responseStream: StreamingResponseHandler<Empty>,
	_requestId?: string,
): Promise<void> {
	return
}

/**
 * Send a worktrees button clicked event to all active subscribers
 */
export async function sendWorktreesButtonClickedEvent(): Promise<void> {
	return
}

import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

/**
 * Subscribe to account button clicked events
 */
export async function subscribeToAccountButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	_responseStream: StreamingResponseHandler<Empty>,
	_requestId?: string,
): Promise<void> {
	return
}

/**
 * Send an account button clicked event to all active subscribers
 */
export async function sendAccountButtonClickedEvent(): Promise<void> {
	return
}

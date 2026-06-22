import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

/**
 * Subscribe to history button clicked events
 */
export async function subscribeToHistoryButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	_responseStream: StreamingResponseHandler<Empty>,
	_requestId?: string,
): Promise<void> {
	return
}

/**
 * Send a history button clicked event to all active subscribers
 */
export async function sendHistoryButtonClickedEvent(): Promise<void> {
	return
}

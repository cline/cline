import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

/**
 * Subscribe to mcpButtonClicked events
 */
export async function subscribeToMcpButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	_responseStream: StreamingResponseHandler<Empty>,
	_requestId?: string,
): Promise<void> {
	return
}

/**
 * Send a mcpButtonClicked event to all active subscribers
 */
export async function sendMcpButtonClickedEvent(): Promise<void> {
	return
}

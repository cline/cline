import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

/**
 * Subscribe to chatButtonClicked events
 */
export async function subscribeToChatButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	_responseStream: StreamingResponseHandler<Empty>,
	_requestId?: string,
): Promise<void> {
	return
}

/**
 * Send a chatButtonClicked event to all active subscribers
 */
export async function sendChatButtonClickedEvent(): Promise<void> {
	return
}

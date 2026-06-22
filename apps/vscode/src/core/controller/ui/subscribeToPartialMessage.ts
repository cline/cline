import { EmptyRequest } from "@shared/proto/cline/common"
import { ClineMessage } from "@shared/proto/cline/ui"
import { StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

/**
 * Subscribe to partial message events
 */
export async function subscribeToPartialMessage(
	_controller: Controller,
	_request: EmptyRequest,
	_responseStream: StreamingResponseHandler<ClineMessage>,
	_requestId?: string,
): Promise<void> {
	return
}

/**
 * Send a partial message event to all active subscribers
 */
export async function sendPartialMessageEvent(_partialMessage: ClineMessage): Promise<void> {
	return
}

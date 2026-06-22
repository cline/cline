import type { EmptyRequest, String as ProtoString } from "@shared/proto/cline/common"
import { type StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"

/**
 * Subscribe to addToInput events
 */
export async function subscribeToAddToInput(
	_controller: Controller,
	_request: EmptyRequest,
	_responseStream: StreamingResponseHandler<ProtoString>,
	_requestId?: string,
): Promise<void> {
	return
}

/**
 * Send an addToInput event to all active subscribers
 */
export async function sendAddToInputEvent(_text: string): Promise<void> {
	return
}

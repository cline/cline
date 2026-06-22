import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"

/**
 * Subscribe to settings button clicked events
 */
export async function subscribeToSettingsButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	_responseStream: StreamingResponseHandler<Empty>,
	_requestId?: string,
): Promise<void> {
	return
}

/**
 * Send a settings button clicked event to all active subscribers
 */
export async function sendSettingsButtonClickedEvent(): Promise<void> {
	return
}

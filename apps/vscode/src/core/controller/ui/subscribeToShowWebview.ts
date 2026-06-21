import { EmptyRequest } from "@shared/proto/cline/common"
import { ShowWebviewEvent } from "@shared/proto/cline/ui"
import { StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"

/**
 * Subscribe to show webview events
 */
export async function subscribeToShowWebview(
	_controller: Controller,
	_request: EmptyRequest,
	_responseStream: StreamingResponseHandler<ShowWebviewEvent>,
	_requestId?: string,
): Promise<void> {
	return
}

/**
 * Send a show webview event to all active subscribers
 */
export async function sendShowWebviewEvent(_preserveEditorFocus: boolean = false): Promise<void> {
	return
}

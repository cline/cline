import { AuthState, EmptyRequest } from "@/shared/proto/index.cline"
import { Controller } from ".."
import { StreamingResponseHandler } from "../grpc-handler"

export async function subscribeToAuthStatusUpdate(
	_controller: Controller,
	_request: EmptyRequest,
	_responseStream: StreamingResponseHandler<AuthState>,
	_requestId?: string,
): Promise<void> {
	return
}

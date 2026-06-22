import { EmptyRequest } from "@shared/proto/cline/common"
import { OcaAuthState } from "@shared/proto/cline/oca_account"
import type { Controller } from ".."
import { StreamingResponseHandler } from "../grpc-handler"

export async function ocaSubscribeToAuthStatusUpdate(
	_controller: Controller,
	_request: EmptyRequest,
	_responseStream: StreamingResponseHandler<OcaAuthState>,
	_requestId?: string,
): Promise<void> {
	return
}

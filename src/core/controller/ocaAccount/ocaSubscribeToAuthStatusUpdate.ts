import { EmptyRequest } from "@shared/proto/cline/common"
import { OcaAuthState } from "@shared/proto/cline/oca_account"
import { AuthManager } from "@/services/auth/AuthManager"
import { Controller } from ".."
import { StreamingResponseHandler } from "../grpc-handler"

export async function ocaSubscribeToAuthStatusUpdate(
	controller: Controller,
	request: EmptyRequest,
	responseStream: StreamingResponseHandler<OcaAuthState>,
	requestId?: string,
): Promise<void> {
	return AuthManager.getInstance().ocaAuthService.subscribeToAuthStatusUpdate(request, responseStream, requestId)
}

import { OcaAuthService } from "@/services/auth/oca/OcaAuthService"
import { AuthState, EmptyRequest } from "@/shared/proto/index.cline"
import { Controller } from ".."
import { StreamingResponseHandler } from "../grpc-handler"

export async function ocaSubscribeToAuthStatusUpdate(
	controller: Controller,
	request: EmptyRequest,
	responseStream: StreamingResponseHandler<AuthState>,
	requestId?: string,
): Promise<void> {
	return OcaAuthService.getInstance().subscribeToAuthStatusUpdate(controller, request, responseStream, requestId)
}

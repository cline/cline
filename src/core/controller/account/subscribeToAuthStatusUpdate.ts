import { AuthState, EmptyRequest } from "@/shared/proto/index.cline"
import { AuthService } from "@services/auth/AuthService"
import { Controller } from ".."
import { StreamingResponseHandler } from "../grpc-handler"

export async function subscribeToAuthStatusUpdate(
	controller: Controller,
	request: EmptyRequest,
	responseStream: StreamingResponseHandler<AuthState>,
	requestId?: string,
): Promise<void> {
	return AuthService.getInstance().subscribeToAuthStatusUpdate(controller, request, responseStream, requestId)
}

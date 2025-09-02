import { AuthManager } from "@/services/auth/AuthManager"
import { AuthState, EmptyRequest } from "@/shared/proto/index.cline"
import { Controller } from ".."
import { StreamingResponseHandler } from "../grpc-handler"

export async function subscribeToAuthStatusUpdate(
	controller: Controller,
	request: EmptyRequest,
	responseStream: StreamingResponseHandler<AuthState>,
	requestId?: string,
): Promise<void> {
	return AuthManager.getInstance().authService.subscribeToAuthStatusUpdate(controller, request, responseStream, requestId)
}

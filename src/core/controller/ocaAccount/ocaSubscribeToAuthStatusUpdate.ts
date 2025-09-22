import type { EmptyRequest } from "@shared/proto/cline/common"
import type { OcaAuthState } from "@shared/proto/cline/oca_account"
import { OcaAuthService } from "@/services/auth/oca/OcaAuthService"
import type { Controller } from ".."
import type { StreamingResponseHandler } from "../grpc-handler"

export async function ocaSubscribeToAuthStatusUpdate(
	_controller: Controller,
	request: EmptyRequest,
	responseStream: StreamingResponseHandler<OcaAuthState>,
	requestId?: string,
): Promise<void> {
	return OcaAuthService.getInstance().subscribeToAuthStatusUpdate(request, responseStream, requestId)
}

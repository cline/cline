import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenAIAuthState } from "@shared/proto/cline/openai_account"
import { Controller } from "@/core/controller"
import { StreamingResponseHandler } from "@/core/controller/grpc-handler"
import { OpenAIAuthService } from "@/services/auth/openai/OpenAIAuthService"

export async function SubscribeToAuthStatusUpdate(
	_controller: Controller,
	request: EmptyRequest,
	responseStream: StreamingResponseHandler<OpenAIAuthState>,
	requestId?: string,
): Promise<void> {
	return OpenAIAuthService.getInstance().subscribeToAuthStatusUpdate(request, responseStream, requestId)
}

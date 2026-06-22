import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

export async function subscribeToLiteLlmModels(
	_controller: Controller,
	_request: EmptyRequest,
	_responseStream: StreamingResponseHandler<OpenRouterCompatibleModelInfo>,
	_requestId?: string,
): Promise<void> {
	return
}

import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import type { Controller } from "../index"

export async function refreshLiteLlmModelsRpc(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	return OpenRouterCompatibleModelInfo.create({})
}

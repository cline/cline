import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { Controller } from ".."

export async function refreshHicapModels(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	return OpenRouterCompatibleModelInfo.create({})
}

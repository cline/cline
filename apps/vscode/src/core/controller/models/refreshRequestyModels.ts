import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { Controller } from ".."

export async function refreshRequestyModels(_controller: Controller, _: EmptyRequest): Promise<OpenRouterCompatibleModelInfo> {
	return OpenRouterCompatibleModelInfo.create({})
}

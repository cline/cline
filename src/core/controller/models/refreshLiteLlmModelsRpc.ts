import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { toProtobufModels } from "@/shared/proto-conversions/models/typeConversion"
import { Controller } from ".."
import { refreshLiteLlmModels } from "./refreshLiteLlmModels"

/**
 * Handles protobuf conversion for gRPC service
 * @param controller The controller instance
 * @param _request Empty request object
 * @returns Response containing LiteLLM models (protobuf types)
 */
export async function refreshLiteLlmModelsRpc(
	controller: Controller,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	const models = await refreshLiteLlmModels(controller)
	return OpenRouterCompatibleModelInfo.create({ models: toProtobufModels(models) })
}

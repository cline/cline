import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { toProtobufModels } from "../../../shared/proto-conversions/models/typeConversion"
import { Controller } from ".."
import { refreshGroqModels } from "./refreshGroqModels"

/**
 * Handles protobuf conversion for gRPC service
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing Groq models (protobuf types)
 */
export async function refreshGroqModelsRpc(
	controller: Controller,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	const models = await refreshGroqModels(controller)
	return OpenRouterCompatibleModelInfo.create({ models: toProtobufModels(models) })
}

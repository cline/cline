import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { toProtobufModels } from "../../../shared/proto-conversions/models/typeConversion"
import { Controller } from ".."
import { refreshBasetenModels } from "./refreshBasetenModels"

/**
 * Handles protobuf conversion for gRPC service
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing Baseten models (protobuf types)
 */
export async function refreshBasetenModelsRpc(
	controller: Controller,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	const models = await refreshBasetenModels(controller)
	return OpenRouterCompatibleModelInfo.create({ models: toProtobufModels(models) })
}

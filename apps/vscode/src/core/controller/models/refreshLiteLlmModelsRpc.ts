import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { toProtobufModels } from "../../../shared/proto-conversions/models/typeConversion"
import type { Controller } from "../index"
import { refreshLiteLlmModels } from "./refreshLiteLlmModels"

/**
 * Refreshes LiteLLM models and returns protobuf types for gRPC
 * @param controller The controller instance
 * @param request Empty request (unused but required for gRPC signature)
 * @returns OpenRouterCompatibleModelInfo with protobuf types
 */
export async function refreshLiteLlmModelsRpc(
	controller: Controller,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	const models = await refreshLiteLlmModels(controller)
	return OpenRouterCompatibleModelInfo.create({
		models: toProtobufModels(models),
	})
}

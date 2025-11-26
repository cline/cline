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
	_controller: Controller,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	try {
		const models = await refreshLiteLlmModels()
		return OpenRouterCompatibleModelInfo.create({
			models: toProtobufModels(models),
		})
	} catch (error) {
		// LiteLLM not configured, this is expected for most users
		// Return empty models list instead of throwing
		return OpenRouterCompatibleModelInfo.create({
			models: {},
		})
	}
}

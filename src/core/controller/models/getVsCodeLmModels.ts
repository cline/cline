import { EmptyRequest } from "@shared/proto/cline/common"
import { VsCodeLmModelsArray } from "@shared/proto/cline/models"
import * as vscode from "vscode"
import { convertVsCodeNativeModelsToProtoModels } from "../../../shared/proto-conversions/models/vscode-lm-models-conversion"
import { Controller } from ".."

/**
 * Fetches available models from VS Code LM API
 * @param controller The controller instance
 * @param request Empty request
 * @returns Array of VS Code LM models
 */
export async function getVsCodeLmModels(_controller: Controller, _request: EmptyRequest): Promise<VsCodeLmModelsArray> {
	try {
		const models = await vscode.lm.selectChatModels({})

		const protoModels = convertVsCodeNativeModelsToProtoModels(models || [])

		return VsCodeLmModelsArray.create({ models: protoModels })
	} catch (error) {
		console.error("Error fetching VS Code LM models:", error)
		return VsCodeLmModelsArray.create({ models: [] })
	}
}

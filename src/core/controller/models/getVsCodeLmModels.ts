import { EmptyRequest } from "@shared/proto/cline/common"
import { VsCodeLmModelsArray } from "@shared/proto/cline/models"
import * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"
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
		// Check if the Language Model API is available
		if (!vscode.lm || typeof vscode.lm.selectChatModels !== "function") {
			Logger.warn("VS Code Language Model API is not available")
			return VsCodeLmModelsArray.create({ models: [] })
		}

		const models = await vscode.lm.selectChatModels({})

		// Log model count for debugging (fixes #8136)
		if (!models || models.length === 0) {
			Logger.debug(
				"VS Code LM: No models returned from selectChatModels. Ensure a language model extension (e.g., GitHub Copilot) is installed and enabled.",
			)
		} else {
			Logger.debug(`VS Code LM: Found ${models.length} model(s)`)
		}

		const protoModels = convertVsCodeNativeModelsToProtoModels(models || [])

		return VsCodeLmModelsArray.create({ models: protoModels })
	} catch (error) {
		Logger.error("Error fetching VS Code LM models:", error)
		return VsCodeLmModelsArray.create({ models: [] })
	}
}

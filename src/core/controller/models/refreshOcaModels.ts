import { Controller } from ".."
import { StringRequest } from "@shared/proto/cline/common"
import { OcaModelInfo, OcaModelInfoMap } from "@shared/proto/cline/models"
import axios from "axios"
import { getAllExtensionState, updateGlobalState } from "@core/storage/state"
import { createOcaHeaders } from "../oca/util/utils"
import { DEFAULT_OCA_BASE_URL } from "../oca/util/constants"
import * as vscode from "vscode"
/**
 * Refreshes the Oca models and returns the updated model list
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing the Oca models
 */
export async function refreshOcaModels(controller: Controller, request: StringRequest): Promise<OcaModelInfoMap> {
	const parsePrice = (price: any) => {
		if (price) {
			return parseFloat(price) * 1_000_000
		}
		return undefined
	}

	let models: Record<string, OcaModelInfo> = {}
	try {
		const { apiConfiguration } = await getAllExtensionState(controller.context)
		const ocaAccessToken = apiConfiguration?.ocaAccessToken
		const baseUrl = request.value || DEFAULT_OCA_BASE_URL
		const modelsUrl = `${baseUrl}/v1/model/info`

		const headers = await createOcaHeaders(ocaAccessToken!, "models-refresh")
		let defaultModelId: string | undefined = undefined

		const response = await axios.get(modelsUrl, { headers })
		if (response.data?.data) {
			for (const model of response.data.data) {
				if (typeof model?.litellm_params?.model !== "string") {
					continue
				}
				const modelId = model.litellm_params.model
				const maxTokens = model.litellm_params?.max_tokens
				if (!modelId) {
					continue
				}
				if (!defaultModelId) {
					defaultModelId = modelId
				}

				const modelInfo = model.model_info

				const ocaModelInfo: OcaModelInfo = OcaModelInfo.create({
					maxTokens: maxTokens || -1,
					contextWindow: modelInfo.context_window,
					supportsImages: modelInfo.supports_vision || false,
					supportsPromptCache: modelInfo.supports_caching || false,
					inputPrice: parsePrice(modelInfo.input_price) || 0,
					outputPrice: parsePrice(modelInfo.output_price) || 0,
					cacheWritesPrice: parsePrice(modelInfo.caching_price) || 0,
					cacheReadsPrice: parsePrice(modelInfo.cached_price) || 0,
					description: modelInfo.description,
					thinkingConfig: modelInfo.thinking_config,
					surveyContent: modelInfo.survey_content,
					surveyId: modelInfo.survey_id,
					temperature: modelInfo.temperature || 0,
					bannerContent: modelInfo.banner,
					modelName: modelId,
				})
				models[modelId] = ocaModelInfo
			}
			console.log("Oca models fetched", models)
			const planModeSelectedModelId =
				apiConfiguration?.planModeOcaModelId && models[apiConfiguration.planModeOcaModelId]
					? apiConfiguration.planModeOcaModelId
					: defaultModelId!
			const planModeSelectedModelInfo = models[planModeSelectedModelId]

			const actModeSelectedModelId =
				apiConfiguration?.actModeOcaModelId && models[apiConfiguration.actModeOcaModelId]
					? apiConfiguration.actModeOcaModelId
					: defaultModelId!
			const actModeSelectedModelInfo = models[actModeSelectedModelId]

			await updateGlobalState(controller.context, "planModeOcaModelId", planModeSelectedModelId)
			await updateGlobalState(controller.context, "planModeOcaModelInfo", planModeSelectedModelInfo)

			await updateGlobalState(controller.context, "actModeOcaModelId", actModeSelectedModelId)
			await updateGlobalState(controller.context, "actModeOcaModelInfo", actModeSelectedModelInfo)

			vscode.window.showInformationMessage(`Refresh Oca models from ${baseUrl}`)
			await controller.postStateToWebview()
		} else {
			console.error("Invalid response from oca API")
			vscode.window.showErrorMessage(`Failed to fetch Oca models. Please check your configuration from ${baseUrl}`)
		}
	} catch (error) {
		console.error("Error fetching oca models:", error)
	}

	return OcaModelInfoMap.create({ models })
}

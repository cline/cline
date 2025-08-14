import { Controller } from ".."
import { StringRequest } from "@shared/proto/cline/common"
import { OcaModelInfo, OcaModelInfoMap } from "@shared/proto/cline/models"
import axios, { AxiosError } from "axios"
import { getAllExtensionState, updateGlobalState } from "@core/storage/state"
import { createOcaHeaders } from "../oca/util/utils"
import { DEFAULT_OCA_BASE_URL } from "../oca/util/constants"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/index.host"
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

	const baseUrl = request.value || DEFAULT_OCA_BASE_URL
	let models: Record<string, OcaModelInfo> = {}
	const { apiConfiguration } = await getAllExtensionState(controller.context)
	const ocaAccessToken = apiConfiguration?.ocaAccessToken

	const modelsUrl = `${baseUrl}/v1/model/info`

	const headers = await createOcaHeaders(ocaAccessToken!, "models-refresh")
	let defaultModelId: string | undefined = undefined

	try {
		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: `Refreshing OCA models from ${baseUrl}`,
		})

		const response = await axios.get(modelsUrl, { headers })
		if (response.data?.data) {
			if (response.data.data.length === 0) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: "No models found. Did you set up your OCA access (possibly through entitlements)?",
				})
			}
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
			console.log("OCA models fetched", models)
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

			await controller.postStateToWebview()
		} else {
			console.error("Invalid response from OCA API")
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Failed to fetch OCA models. Please check your configuration from ${baseUrl}`,
			})
		}
	} catch (err) {
		let userMsg
		if (err.response) {
			// The request was made and the server responded with a status code that falls out of the range of 2xx
			userMsg = `Did you set up your OCA access (possibly through entitlements)? OCA service returned ${err.response.status} ${err.response.statusText}.`
		} else if (err.request) {
			// The request was made but no response was received
			userMsg = `Unable to access the OCA backend. Is your endpoint and proxy configured properly? Please see the troubleshooting guide.`
		} else {
			userMsg = err.message
		}

		console.error(userMsg, err)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `Error refreshing OCA models. ` + userMsg + ` opc-request-id: ${headers["opc-request-id"]}`,
		})
	}

	return OcaModelInfoMap.create({ models })
}

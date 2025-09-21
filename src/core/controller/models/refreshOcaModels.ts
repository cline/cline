import { StringRequest } from "@shared/proto/cline/common"
import { OcaCompatibleModelInfo, OcaModelInfo } from "@shared/proto/cline/models"
import axios from "axios"
import { HostProvider } from "@/hosts/host-provider"
import { OcaAuthService } from "@/services/auth/oca/OcaAuthService"
import { DEFAULT_OCA_BASE_URL } from "@/services/auth/oca/utils/constants"
import { createOcaHeaders, getProxyAgents } from "@/services/auth/oca/utils/utils"
import { Logger } from "@/services/logging/Logger"
import { ShowMessageType } from "@/shared/proto/index.host"
import { Controller } from ".."

/**
 * Refreshes the Oca models and returns the updated model list
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing the Oca models
 */
export async function refreshOcaModels(controller: Controller, request: StringRequest): Promise<OcaCompatibleModelInfo> {
	const parsePrice = (price: any) => {
		if (price) {
			return parseFloat(price) * 1_000_000
		}
		return undefined
	}
	const models: Record<string, OcaModelInfo> = {}
	let defaultModelId: string | undefined
	const ocaAccessToken = await OcaAuthService.getInstance().getAuthToken()
	const baseUrl = request.value || DEFAULT_OCA_BASE_URL
	const modelsUrl = `${baseUrl}/v1/model/info`
	const headers = await createOcaHeaders(ocaAccessToken!, "models-refresh")
	try {
		Logger.log(`Making refresh oca model request with customer opc-request-id: ${headers["opc-request-id"]}`)
		const response = await axios.get(modelsUrl, { headers, ...getProxyAgents() })
		if (response.data?.data) {
			if (response.data.data.length === 0) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: "No models found. Did you set up your OCA access (possibly through entitlements)?",
				})
			}
			for (const model of response.data.data) {
				const modelId = model.litellm_params?.model
				if (typeof modelId !== "string" || !modelId) {
					continue
				}
				if (!defaultModelId) {
					defaultModelId = modelId
				}
				const modelInfo = model.model_info
				models[modelId] = OcaModelInfo.create({
					maxTokens: model.litellm_params?.max_tokens || -1,
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
					banner: modelInfo.banner,
					modelName: modelId,
				})
			}
			console.log("OCA models fetched", models)

			// Fetch current config
			const apiConfiguration = controller.stateManager.getApiConfiguration()
			const updatedConfig = { ...apiConfiguration }

			// Which mode(s) to update?
			const planActSeparateModelsSetting = controller.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")
			const currentMode = (await controller.getCurrentMode?.()) ?? "plan"
			const planModeSelectedModelId =
				apiConfiguration?.planModeOcaModelId && models[apiConfiguration.planModeOcaModelId]
					? apiConfiguration.planModeOcaModelId
					: defaultModelId!
			const actModeSelectedModelId =
				apiConfiguration?.actModeOcaModelId && models[apiConfiguration.actModeOcaModelId]
					? apiConfiguration.actModeOcaModelId
					: defaultModelId!

			// Save new model selection(s) to configuration object, per plan/act mode setting
			if (planActSeparateModelsSetting) {
				if (currentMode === "plan") {
					updatedConfig.planModeOcaModelId = planModeSelectedModelId
					updatedConfig.planModeOcaModelInfo = models[planModeSelectedModelId]
				} else {
					updatedConfig.actModeOcaModelId = actModeSelectedModelId
					updatedConfig.actModeOcaModelInfo = models[actModeSelectedModelId]
				}
			} else {
				updatedConfig.planModeOcaModelId = planModeSelectedModelId
				updatedConfig.planModeOcaModelInfo = models[planModeSelectedModelId]
				updatedConfig.actModeOcaModelId = actModeSelectedModelId
				updatedConfig.actModeOcaModelInfo = models[actModeSelectedModelId]
			}

			controller.stateManager.setApiConfiguration(updatedConfig)

			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: `Refreshed OCA models from ${baseUrl}`,
			})
			await controller.postStateToWebview?.()
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
			console.error(userMsg, err)
		}
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `Error refreshing OCA models. ` + userMsg + ` opc-request-id: ${headers["opc-request-id"]}`,
		})
		return OcaCompatibleModelInfo.create({ error: userMsg })
	}
	return OcaCompatibleModelInfo.create({ models })
}

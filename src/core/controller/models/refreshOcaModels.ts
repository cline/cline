import { StringRequest } from "@shared/proto/cline/common"
import { OcaCompatibleModelInfo, OcaModelInfo } from "@shared/proto/cline/models"
import axios from "axios"
import { HostProvider } from "@/hosts/host-provider"
import { OcaAuthService } from "@/services/auth/oca/OcaAuthService"
import { DEFAULT_EXTERNAL_OCA_BASE_URL, DEFAULT_INTERNAL_OCA_BASE_URL } from "@/services/auth/oca/utils/constants"
import { createOcaHeaders } from "@/services/auth/oca/utils/utils"
import { Logger } from "@/services/logging/Logger"
import { getAxiosSettings } from "@/shared/net"
import { ShowMessageType } from "@/shared/proto/index.host"
import { GlobalStateAndSettings } from "@/shared/storage/state-keys"
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
	if (!ocaAccessToken) {
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "Not authenticated with OCA. Please sign in first.",
		})
		return OcaCompatibleModelInfo.create({ error: "Not authenticated with OCA" })
	}
	const ocaMode = controller.stateManager.getGlobalSettingsKey("ocaMode") || "internal"
	const baseUrl = request.value || (ocaMode === "internal" ? DEFAULT_INTERNAL_OCA_BASE_URL : DEFAULT_EXTERNAL_OCA_BASE_URL)
	const modelsUrl = `${baseUrl}/v1/model/info`
	const headers = await createOcaHeaders(ocaAccessToken!, "models-refresh")
	try {
		Logger.log(`Making refresh oca model request with customer opc-request-id: ${headers["opc-request-id"]}`)
		const response = await axios.get(modelsUrl, { headers, ...getAxiosSettings() })
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

			// Fetch current config to determine existing model selections
			const apiConfiguration = controller.stateManager.getApiConfiguration()
			const planActSeparateModelsSetting = controller.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")
			const currentMode = controller.stateManager.getGlobalSettingsKey("mode")

			const planModeSelectedModelId =
				apiConfiguration?.planModeOcaModelId && models[apiConfiguration.planModeOcaModelId]
					? apiConfiguration.planModeOcaModelId
					: defaultModelId!
			const actModeSelectedModelId =
				apiConfiguration?.actModeOcaModelId && models[apiConfiguration.actModeOcaModelId]
					? apiConfiguration.actModeOcaModelId
					: defaultModelId!

			// Build updates object based on plan/act mode setting
			const updates: Partial<GlobalStateAndSettings> = {}

			if (planActSeparateModelsSetting) {
				if (currentMode === "plan") {
					updates.planModeOcaModelId = planModeSelectedModelId
					updates.planModeOcaModelInfo = models[planModeSelectedModelId]
				} else {
					updates.actModeOcaModelId = actModeSelectedModelId
					updates.actModeOcaModelInfo = models[actModeSelectedModelId]
				}
			} else {
				updates.planModeOcaModelId = planModeSelectedModelId
				updates.planModeOcaModelInfo = models[planModeSelectedModelId]
				updates.actModeOcaModelId = actModeSelectedModelId
				updates.actModeOcaModelInfo = models[actModeSelectedModelId]
			}

			// Update state directly using batch method
			controller.stateManager.setGlobalStateBatch(updates)

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

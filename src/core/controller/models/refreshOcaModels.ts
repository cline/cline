import { StringRequest } from "@shared/proto/cline/common"
import { ApiFormat, OcaCompatibleModelInfo, OcaModelInfo } from "@shared/proto/cline/models"
import axios from "axios"
import { HostProvider } from "@/hosts/host-provider"
import { OcaAuthService } from "@/services/auth/oca/OcaAuthService"
import {
	CHAT_COMPLETIONS_API,
	DEFAULT_EXTERNAL_OCA_BASE_URL,
	DEFAULT_INTERNAL_OCA_BASE_URL,
	MESSAGES_API,
	RESPONSES_API,
} from "@/services/auth/oca/utils/constants"
import { createOcaHeaders } from "@/services/auth/oca/utils/utils"
import { getAxiosSettings } from "@/shared/net"
import { ShowMessageType } from "@/shared/proto/index.host"
import { Logger } from "@/shared/services/Logger"
import { DEFAULT_API_PROVIDER } from "@shared/api"
import { GlobalStateAndSettings, ModeConfigSettings } from "@/shared/storage/state-keys"
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
			return Number.parseFloat(price) * 1_000_000
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
				const supportedApiList = modelInfo.supported_api_list ?? [CHAT_COMPLETIONS_API]

				let apiFormat: ApiFormat = ApiFormat.OPENAI_CHAT
				if (supportsChatCompletions(supportedApiList)) {
					apiFormat = ApiFormat.OPENAI_CHAT
				} else if (supportsResponses(supportedApiList)) {
					apiFormat = ApiFormat.OPENAI_RESPONSES
				} else if (supportsMessages(supportedApiList)) {
					apiFormat = ApiFormat.ANTHROPIC_CHAT
				}

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
					apiFormat: apiFormat,
					supportsReasoning: modelInfo.is_reasoning_model || false,
					reasoningEffortOptions: modelInfo.reasoning_effort_options || [],
				})
			}
			Logger.log("OCA models fetched", models)

			// Fetch current config to determine existing model selections
			const apiConfiguration = controller.stateManager.getApiConfiguration()
			const planConfig = apiConfiguration.planConfig ?? ({} as ModeConfigSettings)
			const actConfig = apiConfiguration.actConfig ?? ({} as ModeConfigSettings)

			const planModeSelectedModelId =
				planConfig.modelId && models[planConfig.modelId] ? planConfig.modelId : defaultModelId!
			const actModeSelectedModelId = actConfig.modelId && models[actConfig.modelId] ? actConfig.modelId : defaultModelId!

			let planModeOcaReasoningEffort
			let actModeOcaReasoningEffort
			if (
				models[planModeSelectedModelId].supportsReasoning &&
				models[planModeSelectedModelId].reasoningEffortOptions.length > 0
			) {
				planModeOcaReasoningEffort =
					planConfig.ocaReasoningEffort ?? models[planModeSelectedModelId].reasoningEffortOptions[0]
			}
			if (
				models[actModeSelectedModelId].supportsReasoning &&
				models[actModeSelectedModelId].reasoningEffortOptions.length > 0
			) {
				actModeOcaReasoningEffort =
					actConfig.ocaReasoningEffort ?? models[actModeSelectedModelId].reasoningEffortOptions[0]
			}

			// Build updates - always update both plan and act configs
			const updates: Partial<GlobalStateAndSettings> = {
				planConfig: {
					...planConfig,
					apiProvider: planConfig.apiProvider ?? DEFAULT_API_PROVIDER,
					modelId: planModeSelectedModelId,
					modelInfo: models[planModeSelectedModelId],
					...(planModeOcaReasoningEffort !== undefined && { ocaReasoningEffort: planModeOcaReasoningEffort }),
				} as ModeConfigSettings,
				actConfig: {
					...actConfig,
					apiProvider: actConfig.apiProvider ?? DEFAULT_API_PROVIDER,
					modelId: actModeSelectedModelId,
					modelInfo: models[actModeSelectedModelId],
					...(actModeOcaReasoningEffort !== undefined && { ocaReasoningEffort: actModeOcaReasoningEffort }),
				} as ModeConfigSettings,
			}

			// Update state directly using batch method
			controller.stateManager.setGlobalStateBatch(updates)

			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: `Refreshed OCA models from ${baseUrl}`,
			})
			await controller.postStateToWebview?.()
		} else {
			Logger.error("Invalid response from OCA API")
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
			Logger.error(userMsg, err)
		}
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `Error refreshing OCA models. ` + userMsg + ` opc-request-id: ${headers["opc-request-id"]}`,
		})
		return OcaCompatibleModelInfo.create({ error: userMsg })
	}
	return OcaCompatibleModelInfo.create({ models })
}

function supportsChatCompletions(modelSupportedApiList: any): boolean {
	return modelSupportedApiList.includes(CHAT_COMPLETIONS_API)
}

function supportsResponses(modelSupportedApiList: any): boolean {
	return modelSupportedApiList.includes(RESPONSES_API)
}

function supportsMessages(modelSupportedApiList: any): boolean {
	return modelSupportedApiList.includes(MESSAGES_API)
}

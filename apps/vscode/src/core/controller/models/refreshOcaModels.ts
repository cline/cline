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
import { GlobalStateAndSettings } from "@/shared/storage/state-keys"
import { Controller } from ".."

/**
 * Refreshes the Oca models and returns the updated model list
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing the Oca models
 */
export async function refreshOcaModels(controller: Controller, request: StringRequest): Promise<OcaCompatibleModelInfo> {
	const parsePrice = (price: unknown) => {
		if (price) {
			return Number.parseFloat(String(price)) * 1_000_000
		}
		return undefined
	}
	const noModelsMessage = "No models found. Did you set up your OCA access (possibly through entitlements)?"
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
	const headers = await createOcaHeaders(ocaAccessToken, "models-refresh")
	try {
		Logger.log(`Making refresh oca model request with customer opc-request-id: ${headers["opc-request-id"]}`)
		const response = await axios.get(modelsUrl, { headers, ...getAxiosSettings() })
		const responseModels = response.data?.data
		if (Array.isArray(responseModels)) {
			if (responseModels.length === 0) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: noModelsMessage,
				})
				return OcaCompatibleModelInfo.create({ error: noModelsMessage })
			}
			for (const model of responseModels) {
				const modelId = model.litellm_params?.model
				if (typeof modelId !== "string" || !modelId) {
					continue
				}
				if (!defaultModelId) {
					defaultModelId = modelId
				}
				const modelInfo = model.model_info ?? {}
				const supportedApiList = Array.isArray(modelInfo.supported_api_list)
					? modelInfo.supported_api_list
					: [CHAT_COMPLETIONS_API]
				const reasoningEffortOptions = Array.isArray(modelInfo.reasoning_effort_options)
					? modelInfo.reasoning_effort_options
					: []

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
					reasoningEffortOptions,
				})
			}
			if (!defaultModelId || Object.keys(models).length === 0) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: noModelsMessage,
				})
				return OcaCompatibleModelInfo.create({ error: noModelsMessage })
			}
			Logger.log("OCA models fetched", models)

			// Fetch current config to determine existing model selections
			const apiConfiguration = controller.stateManager.getApiConfiguration()
			const currentMode = controller.stateManager.getGlobalSettingsKey("mode")

			const preferredModelId =
				currentMode === "plan" ? apiConfiguration?.planModeOcaModelId : apiConfiguration?.actModeOcaModelId
			const fallbackModelId =
				currentMode === "plan" ? apiConfiguration?.actModeOcaModelId : apiConfiguration?.planModeOcaModelId
			const selectedModelId: string =
				(preferredModelId && models[preferredModelId] ? preferredModelId : undefined) ??
				(fallbackModelId && models[fallbackModelId] ? fallbackModelId : undefined) ??
				defaultModelId

			let reasoningEffort: string | undefined
			if (models[selectedModelId].supportsReasoning && models[selectedModelId].reasoningEffortOptions.length > 0) {
				const preferredReasoningEffort =
					currentMode === "plan"
						? apiConfiguration.planModeOcaReasoningEffort
						: apiConfiguration.actModeOcaReasoningEffort
				const fallbackReasoningEffort =
					currentMode === "plan"
						? apiConfiguration.actModeOcaReasoningEffort
						: apiConfiguration.planModeOcaReasoningEffort
				reasoningEffort =
					preferredReasoningEffort ?? fallbackReasoningEffort ?? models[selectedModelId].reasoningEffortOptions[0]
			}

			const updates: Partial<GlobalStateAndSettings> = {}
			updates.planModeOcaModelId = selectedModelId
			updates.planModeOcaModelInfo = models[selectedModelId]
			updates.planModeOcaReasoningEffort = reasoningEffort
			updates.actModeOcaModelId = selectedModelId
			updates.actModeOcaModelInfo = models[selectedModelId]
			updates.actModeOcaReasoningEffort = reasoningEffort

			// Update state directly using batch method
			controller.stateManager.setGlobalStateBatch(updates)

			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: `Refreshed OCA models from ${baseUrl}`,
			})
			await controller.postStateToWebview?.()
		} else {
			Logger.error("Invalid response from OCA API")
			const error = `Failed to fetch OCA models. Please check your configuration from ${baseUrl}`
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: error,
			})
			return OcaCompatibleModelInfo.create({ error })
		}
	} catch (err) {
		let userMsg: string
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
			message: `Error refreshing OCA models. ${userMsg} opc-request-id: ${headers["opc-request-id"]}`,
		})
		return OcaCompatibleModelInfo.create({ error: userMsg })
	}
	return OcaCompatibleModelInfo.create({ models })
}

function supportsChatCompletions(modelSupportedApiList: string[]): boolean {
	return modelSupportedApiList.includes(CHAT_COMPLETIONS_API)
}

function supportsResponses(modelSupportedApiList: string[]): boolean {
	return modelSupportedApiList.includes(RESPONSES_API)
}

function supportsMessages(modelSupportedApiList: string[]): boolean {
	return modelSupportedApiList.includes(MESSAGES_API)
}

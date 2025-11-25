import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo, OpenRouterModelInfo } from "@shared/proto/cline/models"
import axios from "axios"
import { toRequestyServiceUrl } from "@/shared/clients/requesty"
import { getAxiosSettings } from "@/shared/net"
import { Controller } from ".."

/**
 * Refreshes the Requesty models and returns the updated model list
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing the Requesty models
 */
export async function refreshRequestyModels(controller: Controller, _: EmptyRequest): Promise<OpenRouterCompatibleModelInfo> {
	const parsePrice = (price: any) => {
		if (price) {
			return parseFloat(price) * 1_000_000
		}
		return undefined
	}

	const models: Record<string, OpenRouterModelInfo> = {}
	try {
		const apiKey = controller.stateManager.getSecretKey("requestyApiKey")
		const baseUrl = controller.stateManager.getGlobalSettingsKey("requestyBaseUrl")

		const resolvedUrl = toRequestyServiceUrl(baseUrl)
		const url = resolvedUrl != null ? new URL(`${resolvedUrl.pathname}/models`, resolvedUrl).toString() : undefined

		if (url == null) {
			throw new Error("URL is not valid.")
		}

		const headers = {
			Authorization: `Bearer ${apiKey}`,
		}
		const response = await axios.get(url, { headers, ...getAxiosSettings() })
		if (response.data?.data) {
			for (const model of response.data.data) {
				const modelInfo: OpenRouterModelInfo = OpenRouterModelInfo.create({
					maxTokens: model.max_output_tokens || undefined,
					contextWindow: model.context_window,
					supportsImages: model.supports_vision || undefined,
					supportsPromptCache: model.supports_caching || undefined,
					inputPrice: parsePrice(model.input_price) || 0,
					outputPrice: parsePrice(model.output_price) || 0,
					cacheWritesPrice: parsePrice(model.caching_price) || 0,
					cacheReadsPrice: parsePrice(model.cached_price) || 0,
					description: model.description,
				})
				models[model.id] = modelInfo
			}
			console.log("Requesty models fetched", models)
		} else {
			console.error("Invalid response from Requesty API")
		}
	} catch (error) {
		console.error("Error fetching Requesty models:", error)
	}

	return OpenRouterCompatibleModelInfo.create({ models })
}

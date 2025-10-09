import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo, OpenRouterModelInfo } from "@shared/proto/cline/models"
import axios from "axios"
import { Controller } from ".."

/**
 * Refreshes the Cortecs models and returns the updated model list
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing the Cortecs models
 */
export async function refreshCortecsModels(controller: Controller, _: EmptyRequest): Promise<OpenRouterCompatibleModelInfo> {
	const parsePrice = (price: any) => {
		if (price) {
			return parseFloat(price)
		}
		return undefined
	}

	const models: Record<string, OpenRouterModelInfo> = {}
	try {
		const baseUrl = controller.stateManager.getGlobalSettingsKey("cortecsBaseUrl")
			? controller.stateManager.getGlobalSettingsKey("cortecsBaseUrl")
			: "https://api.cortecs.ai/v1"

		const url = new URL(`${baseUrl}/models?tag=Code&currency=USD`).toString()

		if (url == null) {
			throw new Error("URL is not valid.")
		}

		const response = await axios.get(url)
		if (response.data?.data) {
			for (const model of response.data.data) {
				const modelInfo: OpenRouterModelInfo = OpenRouterModelInfo.create({
					maxTokens: 8192,
					contextWindow: model.context_size,
					supportsImages: model.tags.includes("Image"),
					inputPrice: parsePrice(model.pricing.input_token) || 0,
					outputPrice: parsePrice(model.pricing.output_token) || 0,
					description: model.description,
				})
				models[model.id] = modelInfo
			}
			console.log("Cortecs models fetched", models)
		} else {
			console.error("Invalid response from Cortecs API")
		}
	} catch (error) {
		console.error("Error fetching Cortecs models:", error)
	}

	return OpenRouterCompatibleModelInfo.create({ models })
}

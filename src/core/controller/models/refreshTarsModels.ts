import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo, OpenRouterModelInfo } from "@shared/proto/cline/models"
import axios from "axios"
import { Controller } from ".."

// TARS API configuration constants.
const TARS_API_CONFIG = {
	baseUrl: "https://api.router.tetrate.ai/v1",
	modelsEndpoint: "/models",
	priceMultiplier: 1_000_000,
} as const

/**
 * Parse price from API response and convert to per-million tokens format.
 * @param price - Raw price value from API
 * @returns Converted price or undefined if invalid
 */
const parsePrice = (price: unknown): number | undefined => {
	if (typeof price === "string" || typeof price === "number") {
		const numericPrice = parseFloat(String(price))
		return Number.isNaN(numericPrice) ? undefined : numericPrice * TARS_API_CONFIG.priceMultiplier
	}
	return undefined
}

/**
 * Refreshes the TARS models and returns the updated model list.
 * @param controller - The controller instance
 * @param _request - Empty request object (unused)
 * @returns Promise containing the TARS models
 */
export async function refreshTarsModels(controller: Controller, _request: EmptyRequest): Promise<OpenRouterCompatibleModelInfo> {
	const models: Record<string, OpenRouterModelInfo> = {}

	try {
		const apiKey = controller.stateManager.getSecretKey("tarsApiKey")
		const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
		const url = `${TARS_API_CONFIG.baseUrl}${TARS_API_CONFIG.modelsEndpoint}`

		const response = await axios.get(url, { headers })

		if (!response.data?.data || !Array.isArray(response.data.data)) {
			console.warn("Invalid response structure from TARS API:", response.data)
			return OpenRouterCompatibleModelInfo.create({ models })
		}

		for (const model of response.data.data) {
			if (!model.id) {
				console.warn("Skipping model without ID:", model)
				continue
			}

			try {
				const modelInfo: OpenRouterModelInfo = OpenRouterModelInfo.create({
					maxTokens: model.max_output_tokens || undefined,
					contextWindow: model.context_window || undefined,
					supportsImages: model.supports_vision || undefined,
					supportsPromptCache: model.supports_caching || undefined,
					inputPrice: parsePrice(model.input_price) || 0,
					outputPrice: parsePrice(model.output_price) || 0,
					cacheWritesPrice: parsePrice(model.caching_price) || 0,
					cacheReadsPrice: parsePrice(model.cached_price) || 0,
					description: model.description || undefined,
				})
				models[model.id] = modelInfo
			} catch (modelError) {
				console.warn(`Failed to process model ${model.id}:`, modelError)
			}
		}
	} catch (error) {
		if (axios.isAxiosError(error)) {
			const status = error.response?.status
			const statusText = error.response?.statusText || "Unknown error"
			console.error(`TARS API request failed [${status}]: ${statusText}`, {
				url: error.config?.url,
				message: error.message,
			})
		} else if (error instanceof Error) {
			console.error("Error fetching TARS models:", error.message)
		} else {
			console.error("Unknown error fetching TARS models:", error)
		}
	}

	return OpenRouterCompatibleModelInfo.create({ models })
}

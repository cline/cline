import { IoIntelligenceModelsRequest, OpenRouterCompatibleModelInfo, OpenRouterModelInfo } from "@shared/proto/cline/models"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { ensureCacheDirectoryExists } from "@/core/storage/disk"
import { getAxiosSettings } from "@/shared/net"
import { Controller } from ".."

/**
 * Model data returned from IO Intelligence API
 */
interface IoIntelligenceModel {
	id: string
	object: string
	created: number
	owned_by: string
	max_tokens?: number | null
	context_window?: number
	supports_images_input?: boolean
	supports_prompt_cache?: boolean
	input_token_price?: number
	output_token_price?: number
	cache_write_token_price?: number
	cache_read_token_price?: number
}

interface IoIntelligenceModelsResponse {
	object: string
	data: IoIntelligenceModel[]
}

/**
 * Refreshes the IO Intelligence models and returns the updated model list
 * @param controller The controller instance
 * @param request Request containing optional API key (not required for fetching models)
 * @returns Response containing the IO Intelligence models
 */
export async function refreshIoIntelligenceModels(
	_controller: Controller,
	request: IoIntelligenceModelsRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	const ioIntelligenceModelsFilePath = path.join(await ensureCacheDirectoryExists(), "iointelligence_models.json")

	let models: Record<string, OpenRouterModelInfo> = {}

	// Use static base URL - IO Intelligence models endpoint doesn't change
	const baseUrl = "https://api.intelligence.io.solutions"
	// Normalize base URL to ensure it ends with /api/v1
	let normalizedBaseUrl = baseUrl.replace(/\/$/, "")
	if (!normalizedBaseUrl.endsWith("/api/v1")) {
		normalizedBaseUrl = `${normalizedBaseUrl}/api/v1`
	}
	// Construct the full models endpoint URL
	const apiUrl = `${normalizedBaseUrl}/models`

	try {
		// Fetch models from IO Intelligence API (API key is optional for model listing)
		const headers: Record<string, string> = {}
		if (request.apiKey) {
			headers.Authorization = `Bearer ${request.apiKey}`
		}

		const response = await axios.get<IoIntelligenceModelsResponse>(apiUrl, {
			headers,
			timeout: 10000,
			...getAxiosSettings(),
		})

		if (response.data?.data) {
			const rawModels = response.data.data

			// Transform IO Intelligence models to OpenRouter-compatible format
			for (const rawModel of rawModels) {
				const modelInfo = OpenRouterModelInfo.create({
					maxTokens: rawModel.max_tokens || undefined,
					contextWindow: rawModel.context_window || 128_000,
					supportsImages: rawModel.supports_images_input ?? false,
					supportsPromptCache: rawModel.supports_prompt_cache ?? false,
					inputPrice: rawModel.input_token_price ? rawModel.input_token_price * 1_000_000 : 0,
					outputPrice: rawModel.output_token_price ? rawModel.output_token_price * 1_000_000 : 0,
					cacheWritesPrice: rawModel.cache_write_token_price ? rawModel.cache_write_token_price * 1_000_000 : 0,
					cacheReadsPrice: rawModel.cache_read_token_price ? rawModel.cache_read_token_price * 1_000_000 : 0,
					description: `Owned by: ${rawModel.owned_by}${rawModel.context_window ? ` | Context: ${rawModel.context_window.toLocaleString()} tokens` : ""}`,
				})

				models[rawModel.id] = modelInfo
			}

			// Save to cache
			await fs.writeFile(ioIntelligenceModelsFilePath, JSON.stringify(models, null, 2))
		}
	} catch (error) {
		console.error("Error fetching IO Intelligence models:", error)

		// Try to load from cache
		try {
			if (await fileExistsAtPath(ioIntelligenceModelsFilePath)) {
				const cachedModels = await fs.readFile(ioIntelligenceModelsFilePath, "utf-8")
				const parsedModels = JSON.parse(cachedModels)
				models = parsedModels
			}
		} catch (cacheError) {
			console.error("Error loading cached IO Intelligence models:", cacheError)
		}
	}

	return OpenRouterCompatibleModelInfo.create({ models })
}

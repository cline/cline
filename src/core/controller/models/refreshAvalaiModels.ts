import { GlobalFileNames } from "@core/storage/disk"
import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo, OpenRouterModelInfo } from "@shared/proto/cline/models"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { getAxiosSettings } from "@/shared/net"
import { Controller } from ".."

/**
 * The raw model information returned by the AvalAI API to list models
 */
interface AvalaiRawModelInfo {
	id: string
	object: string
	owned_by?: string
	min_tier?: number
	pricing?: {
		input?: number
		cached_input?: number
		output?: number
		search_context_cost_per_query?: Record<string, number>
	}
	max_requests_per_1_minute?: number
	max_tokens_per_1_minute?: number
	max_tokens?: number
	max_input_tokens?: number
	max_output_tokens?: number
	max_images_per_prompt?: number
	max_videos_per_prompt?: number
	mode?: string
	supports_system_messages?: boolean
	supports_function_calling?: boolean
	supports_parallel_function_calling?: boolean
	supports_vision?: boolean
	supports_pdf_input?: boolean
	supports_native_streaming?: boolean
	supports_prompt_caching?: boolean
	supports_tool_choice?: boolean
	supports_response_schema?: boolean
	supported_endpoints?: string[]
}

interface AvalaiModelsResponse {
	object: string
	data: AvalaiRawModelInfo[]
}

/**
 * Refreshes the AvalAI models and returns the updated model list
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing the models
 */
export async function refreshAvalaiModels(
	controller: Controller,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	const avalaiModelsFilePath = path.join(await ensureCacheDirectoryExists(controller), GlobalFileNames.avalaiModels)

	const models: Record<string, OpenRouterModelInfo> = {}
	try {
		// Public endpoint - no auth required
		const response = await axios.get<AvalaiModelsResponse>("https://api.avalai.ir/public/models", {
			...getAxiosSettings(),
		})

		if (response.data?.data) {
			const rawModels = response.data.data

			for (const rawModel of rawModels) {
				// Exclude non-chat models (image generation, moderation, search, rerank)
				const excludedModes = ["image_generation", "moderation", "search", "rerank"]
				if (!rawModel.mode || !excludedModes.includes(rawModel.mode)) {
					models[rawModel.id] = {
						maxTokens: rawModel.max_output_tokens || rawModel.max_tokens || 8192,
						contextWindow: rawModel.max_input_tokens || 128_000,
						supportsImages: rawModel.supports_vision || false,
						supportsPromptCache: rawModel.supports_prompt_caching || false,
						inputPrice: rawModel.pricing?.input || 0,
						outputPrice: rawModel.pricing?.output || 0,
						cacheWritesPrice: 0,
						cacheReadsPrice: rawModel.pricing?.cached_input || 0,
						tiers: [],
						description: `${rawModel.owned_by ? `by ${rawModel.owned_by}` : ""}${
							rawModel.supports_function_calling ? " • Function calling" : ""
						}${rawModel.supports_vision ? " • Vision" : ""}${rawModel.supports_pdf_input ? " • PDF" : ""}`.trim(),
					}
				}
			}
		}
		await fs.writeFile(avalaiModelsFilePath, JSON.stringify(models))
	} catch (_error) {
		// If we failed to fetch models, try to read cached models
		const cachedModels = await readAvalaiModels(controller)
		if (cachedModels) {
			return OpenRouterCompatibleModelInfo.create({ models: cachedModels })
		}
	}

	return OpenRouterCompatibleModelInfo.create({ models })
}

/**
 * Reads cached AvalAI models from disk
 */
async function readAvalaiModels(controller: Controller): Promise<Record<string, OpenRouterModelInfo> | undefined> {
	const avalaiModelsFilePath = path.join(await ensureCacheDirectoryExists(controller), GlobalFileNames.avalaiModels)
	const fileExists = await fileExistsAtPath(avalaiModelsFilePath)
	if (fileExists) {
		try {
			const fileContents = await fs.readFile(avalaiModelsFilePath, "utf8")
			return JSON.parse(fileContents)
		} catch (_error) {
			return undefined
		}
	}
	return undefined
}

/**
 * Ensures the cache directory exists and returns its path
 */
async function ensureCacheDirectoryExists(controller: Controller): Promise<string> {
	const cacheDir = path.join(controller.context.globalStorageUri.fsPath, "cache")
	await fs.mkdir(cacheDir, { recursive: true })
	return cacheDir
}

import { Controller } from ".."
import { EmptyRequest } from "../../../shared/proto/common"
import { MakehubCompatibleModelInfo, MakehubModelInfo } from "../../../shared/proto/models"
import axios from "axios"
import path from "path"
import fs from "fs/promises"
import { fileExistsAtPath } from "@utils/fs"
import { GlobalFileNames } from "@core/storage/disk"

/**
 * Refreshes the MakeHub models and returns the updated model list
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing the MakeHub models
 */
export async function refreshMakehubModels(controller: Controller, request: EmptyRequest): Promise<MakehubCompatibleModelInfo> {
	const makehubModelsFilePath = path.join(await ensureCacheDirectoryExists(controller), GlobalFileNames.makehubModels)

	let models: Record<string, Partial<MakehubModelInfo>> = {}

	try {
		const response = await axios.get("https://api.makehub.ai/v1/models", {
			headers: {
				"HTTP-Referer": "https://cline.bot",
				"X-Title": "Cline",
			},
			timeout: 10000,
		})

		if (response.data?.data) {
			// Filter models with assistant_ready=true
			const filteredModels = response.data.data.filter((model: any) => model.assistant_ready)

			const parsePrice = (price: any) => {
				if (price !== undefined && price !== null) {
					const parsed = parseFloat(price)
					return isNaN(parsed) ? 0 : parsed * 1_000_000
				}
				return 0 // Default to 0 if price is not available or invalid
			}

			// Convert to ModelInfo format
			for (const rawModel of filteredModels) {
				const modelInfo: Partial<MakehubModelInfo> = {
					maxTokens: rawModel.max_tokens || 8192, // max_tokens is not in API, using default
					contextWindow: rawModel.context ? rawModel.context * 1024 : 0, // context is in K, converting to total tokens
					supportsImages: rawModel.supports_images ?? rawModel.capabilities?.image_input ?? false, // API doesn't provide this directly
					supportsPromptCache: rawModel.supports_prompt_cache ?? false, // API doesn't provide this
					inputPrice: parsePrice(rawModel.price_per_input_token),
					outputPrice: parsePrice(rawModel.price_per_output_token),
					cacheWritesPrice: parsePrice(
						rawModel.supports_prompt_cache && rawModel.cache_writes_price ? rawModel.cache_writes_price : undefined,
					), // API doesn't provide cache prices
					cacheReadsPrice: parsePrice(
						rawModel.supports_prompt_cache && rawModel.cache_reads_price ? rawModel.cache_reads_price : undefined,
					), // API doesn't provide cache prices
					description: rawModel.model_name || rawModel.model_id,
					displayName: rawModel.display_name || rawModel.model_id,
				}
				models[rawModel.model_id] = modelInfo
			}

			await fs.writeFile(makehubModelsFilePath, JSON.stringify(models))
		} else {
			console.error("Invalid or empty data from MakeHub API. response.data:", response.data)
		}
	} catch (error: any) {
		console.error("Error fetching MakeHub models:", error.message)
		if (error.response) {
			// It's useful to keep these more detailed logs for API errors
			console.error("MakeHub API Error Response Data:", error.response.data)
			console.error("MakeHub API Error Response Status:", error.response.status)
			console.error("MakeHub API Error Response Headers:", error.response.headers)
		}

		// If we failed to fetch models, try to read cached models
		const cachedModels = await readMakehubModels(controller)
		if (cachedModels) {
			models = cachedModels
		}
	}

	// Convert the Record<string, Partial<MakehubModelInfo>> to Record<string, MakehubModelInfo>
	// by filling in any missing required fields with defaults
	const typedModels: Record<string, MakehubModelInfo> = {}
	for (const [key, model] of Object.entries(models)) {
		typedModels[key] = {
			maxTokens: model.maxTokens ?? 8192,
			contextWindow: model.contextWindow ?? 0, // Default to 0 if not set, was 8192
			supportsImages: model.supportsImages ?? false,
			supportsPromptCache: model.supportsPromptCache ?? false,
			inputPrice: model.inputPrice ?? 0,
			outputPrice: model.outputPrice ?? 0,
			cacheWritesPrice: model.cacheWritesPrice ?? 0,
			cacheReadsPrice: model.cacheReadsPrice ?? 0,
			description: model.description ?? "",
			displayName: model.displayName ?? key,
		}
	}

	const result = MakehubCompatibleModelInfo.create({ models: typedModels })
	return result
}

/**
 * Reads cached MakeHub models from disk
 */
async function readMakehubModels(controller: Controller): Promise<Record<string, Partial<MakehubModelInfo>> | undefined> {
	const makehubModelsFilePath = path.join(await ensureCacheDirectoryExists(controller), GlobalFileNames.makehubModels)
	const fileExists = await fileExistsAtPath(makehubModelsFilePath)

	if (fileExists) {
		try {
			const fileContents = await fs.readFile(makehubModelsFilePath, "utf8")
			return JSON.parse(fileContents)
		} catch (error) {
			console.error("Error reading cached MakeHub models:", error)
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

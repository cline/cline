import { huggingFaceModels } from "@shared/api"
import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo, OpenRouterModelInfo } from "@shared/proto/cline/models"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { Controller } from ".."

/**
 * Ensures the cache directory exists and returns its path
 */
async function ensureCacheDirectoryExists(controller: Controller): Promise<string> {
	const cacheDir = path.join(controller.context.globalStorageUri.fsPath, "cache")
	try {
		await fs.mkdir(cacheDir, { recursive: true })
	} catch (_error) {
		// Directory might already exist
	}
	return cacheDir
}

/**
 * Refreshes the Hugging Face models and returns the updated model list
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing the Hugging Face models
 */
export async function refreshHuggingFaceModels(
	controller: Controller,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	const huggingFaceModelsFilePath = path.join(await ensureCacheDirectoryExists(controller), "huggingface_models.json")

	let models: Record<string, OpenRouterModelInfo> = {}

	try {
		// Fetch models from Hugging Face API
		const response = await axios.get("https://router.huggingface.co/v1/models", {
			timeout: 10000,
		})

		if (response.data?.data) {
			const rawModels = response.data.data

			// Transform HF models to OpenRouter-compatible format
			for (const rawModel of rawModels) {
				const providersList = rawModel.providers?.map((provider: { provider: string }) => provider.provider)?.join(", ")
				const modelInfo = OpenRouterModelInfo.create({
					maxTokens: 8192, // HF doesn't provide max_tokens, use default
					contextWindow: 128_000, // FIXME: HF doesn't provide context window, use default
					supportsImages: false, // Most models don't support images
					supportsPromptCache: false,
					inputPrice: 0, // Will be set based on providers
					outputPrice: 0, // Will be set based on providers
					cacheWritesPrice: 0,
					cacheReadsPrice: 0,
					description: `Available on providers: ${providersList || "unknown"}`,
				})

				// Add model-specific configurations if we have them in our static models
				if (rawModel.id in huggingFaceModels) {
					const staticModel = huggingFaceModels[rawModel.id as keyof typeof huggingFaceModels]
					modelInfo.maxTokens = staticModel.maxTokens
					modelInfo.contextWindow = staticModel.contextWindow
					modelInfo.supportsImages = staticModel.supportsImages
					modelInfo.supportsPromptCache = staticModel.supportsPromptCache
					modelInfo.inputPrice = staticModel.inputPrice
					modelInfo.outputPrice = staticModel.outputPrice
					modelInfo.description = staticModel.description || modelInfo.description
				}

				models[rawModel.id] = modelInfo
			}

			// Save to cache
			await fs.writeFile(huggingFaceModelsFilePath, JSON.stringify(models, null, 2))
		}
	} catch (error) {
		console.error("Error fetching Hugging Face models:", error)

		// Try to load from cache
		try {
			if (await fileExistsAtPath(huggingFaceModelsFilePath)) {
				const cachedModels = await fs.readFile(huggingFaceModelsFilePath, "utf-8")
				const parsedModels = JSON.parse(cachedModels)
				models = parsedModels
			}
		} catch (cacheError) {
			console.error("Error loading cached Hugging Face models:", cacheError)
		}

		// If no cache available, use static models as fallback
		if (Object.keys(models).length === 0) {
			for (const [modelId, modelInfo] of Object.entries(huggingFaceModels)) {
				models[modelId] = OpenRouterModelInfo.create({
					maxTokens: modelInfo.maxTokens,
					contextWindow: modelInfo.contextWindow,
					supportsImages: modelInfo.supportsImages,
					supportsPromptCache: modelInfo.supportsPromptCache,
					inputPrice: modelInfo.inputPrice,
					outputPrice: modelInfo.outputPrice,
					cacheWritesPrice: (modelInfo as any).cacheWritesPrice || 0,
					cacheReadsPrice: (modelInfo as any).cacheReadsPrice || 0,
					description: modelInfo.description || "",
				})
			}
		}
	}

	return OpenRouterCompatibleModelInfo.create({ models })
}

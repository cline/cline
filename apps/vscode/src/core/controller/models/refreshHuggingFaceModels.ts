import { getProviderCollectionSync } from "@cline/llms"
import type { ModelInfo } from "@shared/api"
import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo, OpenRouterModelInfo } from "@shared/proto/cline/models"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { ensureCacheDirectoryExists } from "@/core/storage/disk"
import { adaptSdkModelInfo } from "@/sdk/model-catalog/shape-adapter"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Hugging Face's curated catalog from the SDK. Used to supply pricing
 * and capability defaults for live models that match an SDK-known id,
 * and as the offline fallback when neither the live fetch nor the disk
 * cache yields anything.
 */
function getHuggingFaceSdkModels(): Record<string, ModelInfo> {
	const collection = getProviderCollectionSync("huggingface")
	if (!collection) {
		return {}
	}
	const result: Record<string, ModelInfo> = {}
	for (const [modelId, sdkInfo] of Object.entries(collection.models)) {
		result[modelId] = adaptSdkModelInfo(sdkInfo)
	}
	return result
}

const huggingFaceModels = getHuggingFaceSdkModels()

/**
 * Refreshes the Hugging Face models and returns the updated model list
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing the Hugging Face models
 */
export async function refreshHuggingFaceModels(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	const huggingFaceModelsFilePath = path.join(await ensureCacheDirectoryExists(), "huggingface_models.json")

	let models: Record<string, OpenRouterModelInfo> = {}

	try {
		// Fetch models from Hugging Face API
		const response = await axios.get("https://router.huggingface.co/v1/models", {
			timeout: 10000,
			...getAxiosSettings(),
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
		Logger.error("Error fetching Hugging Face models:", error)

		// Try to load from cache
		try {
			if (await fileExistsAtPath(huggingFaceModelsFilePath)) {
				const cachedModels = await fs.readFile(huggingFaceModelsFilePath, "utf-8")
				const parsedModels = JSON.parse(cachedModels)
				models = parsedModels
			}
		} catch (cacheError) {
			Logger.error("Error loading cached Hugging Face models:", cacheError)
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
					cacheWritesPrice: modelInfo.cacheWritesPrice ?? 0,
					cacheReadsPrice: modelInfo.cacheReadsPrice ?? 0,
					description: modelInfo.description ?? "",
				})
			}
		}
	}

	return OpenRouterCompatibleModelInfo.create({ models })
}

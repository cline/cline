import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo, OpenRouterModelInfo } from "@shared/proto/cline/models"
import { fileExistsAtPath } from "@utils/fs"
import { parsePrice } from "@utils/model-utils"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { basetenModels } from "../../../shared/api"
import { Controller } from ".."

/**
 * Refreshes the Baseten models and returns the updated model list
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing the Baseten models
 */
export async function refreshBasetenModels(
	controller: Controller,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	console.log("=== refreshBasetenModels called ===")
	const basetenModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.basetenModels)

	// Get the Baseten API key from the controller's state
	const basetenApiKey = controller.stateManager.getSecretKey("basetenApiKey")

	const models: Record<string, Partial<OpenRouterModelInfo> & { supportedFeatures?: string[] }> = {}
	try {
		if (!basetenApiKey) {
			console.log("No Baseten API key found, using static models as fallback")
			// Don't throw an error, just use static models, althought this might be slightly out of date
			for (const [modelId, modelInfo] of Object.entries(basetenModels)) {
				models[modelId] = {
					maxTokens: modelInfo.maxTokens,
					contextWindow: modelInfo.contextWindow,
					supportsImages: modelInfo.supportsImages,
					supportsPromptCache: modelInfo.supportsPromptCache,
					inputPrice: modelInfo.inputPrice,
					outputPrice: modelInfo.outputPrice,
					cacheWritesPrice: (modelInfo as any).cacheWritesPrice || 0,
					cacheReadsPrice: (modelInfo as any).cacheReadsPrice || 0,
					description: (modelInfo as any).description || `${modelId} model`,
				}
			}
		} else {
			// Ensure the API key is properly formatted
			const cleanApiKey = basetenApiKey.trim()
			if (!cleanApiKey) {
				throw new Error("Invalid Baseten API key format")
			}

			console.log("Fetching Baseten models with API key:", cleanApiKey.substring(0, 10) + "...")

			const response = await axios.get("https://inference.baseten.co/v1/models", {
				headers: {
					Authorization: `Bearer ${cleanApiKey}`,
					"Content-Type": "application/json",
					"User-Agent": "Cline-VSCode-Extension",
				},
				timeout: 10000, // 10 second timeout
			})

			if (response.data?.data) {
				const rawModels = response.data.data

				for (const rawModel of rawModels) {
					// Filter out non-chat models and validate model capabilities
					if (!isValidChatModel(rawModel)) {
						continue
					}

					// Check if we have static pricing information for this model
					const staticModelInfo = basetenModels[rawModel.id as keyof typeof basetenModels]

					const modelInfo: Partial<OpenRouterModelInfo> & { supportedFeatures?: string[] } = {
						maxTokens: rawModel.max_completion_tokens || staticModelInfo?.maxTokens,
						contextWindow: rawModel.context_length || staticModelInfo?.contextWindow,
						supportsImages: false, // Baseten model APIs does not support image input
						supportsPromptCache: staticModelInfo?.supportsPromptCache || false,
						inputPrice: parsePrice(rawModel.pricing?.prompt) || staticModelInfo?.inputPrice || 0,
						outputPrice: parsePrice(rawModel.pricing?.completion) || staticModelInfo?.outputPrice || 0,
						cacheWritesPrice: staticModelInfo?.cacheWritesPrice || 0,
						cacheReadsPrice: staticModelInfo?.cacheReadsPrice || 0,
						description: generateModelDescription(rawModel, staticModelInfo),
						supportedFeatures: rawModel.supported_features || [],
					}

					models[rawModel.id] = modelInfo
				}
			} else {
				console.error("Invalid response from Baseten API")
			}
			await fs.writeFile(basetenModelsFilePath, JSON.stringify(models))
			console.log("Baseten models fetched and saved:", Object.keys(models))
		}
	} catch (error) {
		console.error("Error fetching Baseten models:", error)

		// Provide more specific error messages
		let errorMessage = "Unknown error occurred"
		if (axios.isAxiosError(error)) {
			if (error.response?.status === 401) {
				errorMessage = "Invalid Baseten API key. Please check your API key in settings."
			} else if (error.response?.status === 403) {
				errorMessage = "Access forbidden. Please verify your Baseten API key has the correct permissions."
			} else if (error.response?.status === 429) {
				errorMessage = "Rate limit exceeded. Please try again later."
			} else if (error.code === "ECONNABORTED") {
				errorMessage = "Request timeout. Please check your internet connection."
			} else {
				errorMessage = `API request failed: ${error.response?.status || error.code || "Unknown error"}`
			}
		} else if (error instanceof Error) {
			errorMessage = error.message
		}

		console.error("Baseten API Error:", errorMessage)

		// If we failed to fetch models, try to read cached models first
		const cachedModels = await readBasetenModels()
		if (cachedModels && Object.keys(cachedModels).length > 0) {
			console.log("Using cached Baseten models")
			// Use all cached models (no filtering)
			for (const [modelId, modelInfo] of Object.entries(cachedModels)) {
				models[modelId] = modelInfo
			}
		} else {
			// Fall back to static models from shared/api.ts
			console.log("Using static Baseten models as fallback")
			for (const [modelId, modelInfo] of Object.entries(basetenModels)) {
				models[modelId] = {
					maxTokens: modelInfo.maxTokens,
					contextWindow: modelInfo.contextWindow,
					supportsImages: modelInfo.supportsImages,
					supportsPromptCache: modelInfo.supportsPromptCache,
					inputPrice: modelInfo.inputPrice,
					outputPrice: modelInfo.outputPrice,
					cacheWritesPrice: (modelInfo as any).cacheWritesPrice || 0,
					cacheReadsPrice: (modelInfo as any).cacheReadsPrice || 0,
					description: (modelInfo as any).description || `${modelId} model`,
				}
			}
		}
	}

	// Convert the Record<string, Partial<OpenRouterModelInfo>> to Record<string, OpenRouterModelInfo>
	// by filling in any missing required fields with defaults
	const typedModels: Record<string, OpenRouterModelInfo> = {}
	for (const [key, model] of Object.entries(models)) {
		typedModels[key] = {
			maxTokens: model.maxTokens ?? 8192,
			contextWindow: model.contextWindow ?? 8192,
			supportsImages: model.supportsImages ?? false,
			supportsPromptCache: model.supportsPromptCache ?? false,
			inputPrice: model.inputPrice ?? 0,
			outputPrice: model.outputPrice ?? 0,
			cacheWritesPrice: model.cacheWritesPrice ?? 0,
			cacheReadsPrice: model.cacheReadsPrice ?? 0,
			description: model.description ?? "",
			tiers: model.tiers ?? [],
			// Note: supportedFeatures is preserved as custom property but not part of OpenRouterModelInfo proto
		}
	}

	return OpenRouterCompatibleModelInfo.create({ models: typedModels })
}

/**
 * Reads cached Baseten models from disk
 */
async function readBasetenModels(): Promise<Record<string, Partial<OpenRouterModelInfo>> | undefined> {
	const basetenModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.basetenModels)
	const fileExists = await fileExistsAtPath(basetenModelsFilePath)
	if (fileExists) {
		try {
			const fileContents = await fs.readFile(basetenModelsFilePath, "utf8")
			return JSON.parse(fileContents)
		} catch (error) {
			console.error("Error reading cached Baseten models:", error)
			return undefined
		}
	}
	return undefined
}

/**
 * Validates if a model is suitable for chat completions
 */
function isValidChatModel(rawModel: any): boolean {
	// Filter out non-chat models (whisper, TTS, guard models, etc.)
	if (rawModel.id.includes("whisper") || rawModel.id.includes("tts") || rawModel.id.includes("embedding")) {
		return false
	}

	// Check if model supports chat completions
	if (rawModel.object === "model" && rawModel.id) {
		return true
	}

	return false
}

/**
 * Generates a descriptive name for the model
 */
function generateModelDescription(rawModel: any, staticModelInfo?: any): string {
	// Use static description if available and preferred
	if (staticModelInfo?.description) {
		return staticModelInfo.description
	}

	// Use API description if available
	if (rawModel.description) {
		const contextWindow = rawModel.context_length
		const quantization = rawModel.quantization
		const features = rawModel.supported_features || []

		let description = rawModel.description

		// Add technical details if available
		const technicalDetails = []
		if (contextWindow) {
			technicalDetails.push(`${contextWindow.toLocaleString()} token context`)
		}
		if (quantization) {
			technicalDetails.push(`${quantization} precision`)
		}
		if (features.length > 0) {
			const featureList = features.join(", ")
			technicalDetails.push(`supports ${featureList}`)
		}

		if (technicalDetails.length > 0) {
			description += ` (${technicalDetails.join(", ")})`
		}

		return description
	}

	// Fallback: use name or model ID
	const modelName = rawModel.name || rawModel.id
	const contextWindow = rawModel.context_length
	const ownedBy = rawModel.owned_by || "Baseten"

	if (contextWindow) {
		return `${ownedBy} ${modelName} with ${contextWindow.toLocaleString()} token context window`
	}

	return `${ownedBy} model: ${modelName}`
}

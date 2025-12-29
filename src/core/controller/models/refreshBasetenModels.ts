import fs from "node:fs/promises"
import path from "node:path"
import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { ANTHROPIC_MAX_THINKING_BUDGET, ModelInfo } from "@shared/api"
import { fileExistsAtPath } from "@utils/fs"
import { parsePrice } from "@utils/model-utils"
import axios from "axios"
import { getAxiosSettings } from "@/shared/net"
import { basetenModels } from "../../../shared/api"
import { Controller } from ".."

/**
 * Core function: Refreshes the Baseten models and returns application types
 * @param controller The controller instance
 * @returns Record of model ID to ModelInfo (application types)
 */
export async function refreshBasetenModels(controller: Controller): Promise<Record<string, ModelInfo>> {
	const basetenModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.basetenModels)

	// Get the Baseten API key from the controller's state
	const basetenApiKey = controller.stateManager.getSecretKey("basetenApiKey")

	const models: Record<string, Partial<ModelInfo> & { supportedFeatures?: string[] }> = {}
	try {
		if (basetenApiKey) {
			// Ensure the API key is properly formatted
			const cleanApiKey = basetenApiKey.trim()
			if (!cleanApiKey) {
				throw new Error("Invalid Baseten API key format")
			}

			const response = await axios.get("https://inference.baseten.co/v1/models", {
				headers: {
					Authorization: `Bearer ${cleanApiKey}`,
					"Content-Type": "application/json",
					"User-Agent": "Cline-VSCode-Extension",
				},
				timeout: 10000, // 10 second timeout
				...getAxiosSettings(),
			})

			const rawModels = response?.data?.data

			if (rawModels && Array.isArray(rawModels)) {
				for (const rawModel of rawModels) {
					// Filter out non-chat models and validate model capabilities
					if (!isValidChatModel(rawModel)) {
						continue
					}

					// Check if we have static pricing information for this model
					const staticModelInfo = basetenModels[rawModel.id as keyof typeof basetenModels]
					const supportThinking = rawModel?.supported_features?.some(
						(p: string) => p === "reasoning_effort" || p === "reasoning",
					)

					const modelInfo: Partial<ModelInfo> & { supportedFeatures?: string[] } = {
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
						supportsReasoning: supportThinking || false,
						// If thinking is supported, set maxBudget with a default value as a placeholder
						// to ensure it has a valid thinkingConfig that lets the application know thinking is supported.
						thinkingConfig: supportThinking ? { maxBudget: ANTHROPIC_MAX_THINKING_BUDGET } : undefined,
					}

					models[rawModel.id] = modelInfo
				}
			}
			// Cache the fetched models to disk
			await fs.writeFile(basetenModelsFilePath, JSON.stringify(models))
		}

		// If no API key is set or models is empty, throw an error to trigger fallback
		if (Object.keys(models).length === 0) {
			throw new Error("No Baseten API key set or no models fetched")
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
			// Use all cached models (no filtering)
			for (const [modelId, modelInfo] of Object.entries(cachedModels)) {
				models[modelId] = modelInfo
			}
		} else {
			// Fall back to static models from shared/api.ts
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
					supportsReasoning: modelInfo.supportsReasoning || false,
					thinkingConfig: modelInfo.supportsReasoning ? { maxBudget: ANTHROPIC_MAX_THINKING_BUDGET } : undefined,
				}
			}
		}
	}

	// Convert the Record<string, Partial<ModelInfo>> to Record<string, ModelInfo>
	// by filling in any missing required fields with defaults
	const typedModels: Record<string, ModelInfo> = {}
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
			tiers: model.tiers,
			supportsReasoning: model.supportsReasoning || false,
			thinkingConfig: model.supportsReasoning ? { maxBudget: ANTHROPIC_MAX_THINKING_BUDGET } : undefined,
		}
	}

	return typedModels
}

/**
 * Reads cached Baseten models from disk (application types)
 */
async function readBasetenModels(): Promise<Record<string, Partial<ModelInfo>> | undefined> {
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

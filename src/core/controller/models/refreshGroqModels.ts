import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { ModelInfo } from "@shared/api"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { telemetryService } from "@/services/telemetry"
import { getAxiosSettings } from "@/shared/net"
import { groqModels } from "../../../shared/api"
import { Controller } from ".."

/**
 * Core function: Refreshes the Groq models and returns application types
 * @param controller The controller instance
 * @returns Record of model ID to ModelInfo (application types)
 */
export async function refreshGroqModels(controller: Controller): Promise<Record<string, ModelInfo>> {
	const groqModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.groqModels)

	const groqApiKey = controller.stateManager.getSecretKey("groqApiKey")

	let models: Record<string, Partial<ModelInfo>> = {}
	try {
		if (!groqApiKey) {
			console.log("No Groq API key found, using static models as fallback")
			// Don't throw an error, just use static models
			for (const [modelId, modelInfo] of Object.entries(groqModels)) {
				models[modelId] = {
					maxTokens: modelInfo.maxTokens,
					contextWindow: modelInfo.contextWindow,
					supportsImages: modelInfo.supportsImages,
					supportsPromptCache: modelInfo.supportsPromptCache,
					inputPrice: modelInfo.inputPrice,
					outputPrice: modelInfo.outputPrice,
					cacheWritesPrice: (modelInfo as any).cacheWritesPrice || 0,
					cacheReadsPrice: (modelInfo as any).cacheReadsPrice || 0,
					description: modelInfo.description || `${modelId} model`,
				}
			}
		} else {
			// Ensure the API key is properly formatted
			const cleanApiKey = groqApiKey.trim()
			if (!cleanApiKey.startsWith("gsk_")) {
				throw new Error("Invalid Groq API key format. Groq API keys should start with 'gsk_'")
			}

			console.log("Fetching Groq models with API key:", cleanApiKey.substring(0, 10) + "...")

			const response = await axios.get("https://api.groq.com/openai/v1/models", {
				headers: {
					Authorization: `Bearer ${cleanApiKey}`,
					"Content-Type": "application/json",
					"User-Agent": "Cline-VSCode-Extension",
				},
				timeout: 10000, // 10 second timeout
				...getAxiosSettings(),
			})

			if (response.data?.data) {
				const rawModels = response.data.data

				for (const rawModel of rawModels) {
					// Filter out non-chat models and validate model capabilities
					if (!isValidChatModel(rawModel)) {
						continue
					}

					// Check if we have static pricing information for this model
					const staticModelInfo = groqModels[rawModel.id as keyof typeof groqModels]

					const modelInfo: Partial<ModelInfo> = {
						maxTokens: rawModel.max_completion_tokens || staticModelInfo?.maxTokens || 8192,
						contextWindow: rawModel.context_window || staticModelInfo?.contextWindow || 8192,
						supportsImages: detectImageSupport(rawModel, staticModelInfo),
						supportsPromptCache: staticModelInfo?.supportsPromptCache || false,
						inputPrice: staticModelInfo?.inputPrice || 0,
						outputPrice: staticModelInfo?.outputPrice || 0,
						cacheWritesPrice: (staticModelInfo as any)?.cacheWritesPrice || 0,
						cacheReadsPrice: (staticModelInfo as any).cacheReadsPrice || 0,
						description: generateModelDescription(rawModel, staticModelInfo),
					}

					models[rawModel.id] = modelInfo
				}
			} else {
				console.error("Invalid response from Groq API")
			}
			await fs.writeFile(groqModelsFilePath, JSON.stringify(models))
			console.log("Groq models fetched and saved", models)
		}
	} catch (error) {
		console.error("Error fetching Groq models:", error)

		// Provide more specific error messages
		let errorMessage = "Unknown error occurred"
		if (axios.isAxiosError(error)) {
			if (error.response?.status === 401) {
				errorMessage = "Invalid Groq API key. Please check your API key in settings."
			} else if (error.response?.status === 403) {
				errorMessage = "Access forbidden. Please verify your Groq API key has the correct permissions."
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

		telemetryService.captureProviderApiError({
			ulid: controller.task?.ulid || "",
			errorMessage,
			errorStatus: error.status,
			model: "groq",
		})

		// If we failed to fetch models, try to read cached models first
		const cachedModels = await readGroqModels()
		if (cachedModels && Object.keys(cachedModels).length > 0) {
			console.log("Using cached Groq models")
			models = cachedModels
		} else {
			// Fall back to static models from shared/api.ts
			console.log("Using static Groq models as fallback")
			for (const [modelId, modelInfo] of Object.entries(groqModels)) {
				models[modelId] = {
					maxTokens: modelInfo.maxTokens,
					contextWindow: modelInfo.contextWindow,
					supportsImages: modelInfo.supportsImages,
					supportsPromptCache: modelInfo.supportsPromptCache,
					inputPrice: modelInfo.inputPrice,
					outputPrice: modelInfo.outputPrice,
					cacheWritesPrice: (modelInfo as any).cacheWritesPrice || 0,
					cacheReadsPrice: (modelInfo as any).cacheReadsPrice || 0,
					description: modelInfo.description || `${modelId} model`,
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
		}
	}

	return typedModels
}

/**
 * Reads cached Groq models from disk (application types)
 */
async function readGroqModels(): Promise<Record<string, Partial<ModelInfo>> | undefined> {
	const groqModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.groqModels)
	const fileExists = await fileExistsAtPath(groqModelsFilePath)
	if (fileExists) {
		try {
			const fileContents = await fs.readFile(groqModelsFilePath, "utf8")
			return JSON.parse(fileContents)
		} catch (error) {
			console.error("Error reading cached Groq models:", error)
			return undefined
		}
	}
	return undefined
}

/**
 * Validates if a model is suitable for chat completions
 */
function isValidChatModel(rawModel: any): boolean {
	// Check if model is active (if the property exists)
	if (Object.hasOwn(rawModel, "active") && !rawModel.active) {
		return false
	}
	// Filter out non-chat models (whisper, TTS, guard models, etc.)
	if (
		rawModel.id.includes("whisper") ||
		rawModel.id.includes("tts") ||
		rawModel.id.includes("guard") ||
		rawModel.id.includes("embedding") ||
		rawModel.id.includes("moderation") ||
		rawModel.id.includes("allam")
	) {
		return false
	}

	// Check if model supports chat completions
	if (rawModel.object === "model" && rawModel.id) {
		return true
	}

	return false
}

/**
 * Detects if a model supports image input
 */
function detectImageSupport(rawModel: any, staticModelInfo?: any): boolean {
	// Use static info if available
	if (staticModelInfo?.supportsImages !== undefined) {
		return staticModelInfo.supportsImages
	}

	// Detect based on model name patterns
	const modelId = rawModel.id.toLowerCase()
	if (modelId.includes("vision") || modelId.includes("maverick") || modelId.includes("scout")) {
		return true
	}

	return false
}

/**
 * Generates a descriptive name for the model
 */
function generateModelDescription(rawModel: any, staticModelInfo?: any): string {
	// Use static description if available
	if (staticModelInfo?.description) {
		return staticModelInfo.description
	}

	// Generate description based on model characteristics
	const modelId = rawModel.id
	const contextWindow = rawModel.context_window || 8192
	const ownedBy = rawModel.owned_by || "Unknown"

	// Special handling for new models
	if (modelId.includes("compound")) {
		return `${ownedBy}'s ${modelId} model with ${contextWindow.toLocaleString()} token context window - Advanced compound architecture`
	}

	return `${ownedBy} model with ${contextWindow.toLocaleString()} token context window`
}

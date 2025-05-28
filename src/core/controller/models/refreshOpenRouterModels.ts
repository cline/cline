import { Controller } from ".."
import { EmptyRequest } from "../../../shared/proto/common"
import { OpenRouterCompatibleModelInfo, OpenRouterModelInfo } from "../../../shared/proto/models"
import axios from "axios"
import path from "path"
import fs from "fs/promises"
import { fileExistsAtPath } from "@utils/fs"
import { GlobalFileNames } from "@core/storage/disk"

/**
 * Refreshes the OpenRouter models and returns the updated model list
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing the OpenRouter models
 */
export async function refreshOpenRouterModels(
	controller: Controller,
	request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	const openRouterModelsFilePath = path.join(await ensureCacheDirectoryExists(controller), GlobalFileNames.openRouterModels)

	let models: Record<string, Partial<OpenRouterModelInfo>> = {}
	try {
		const response = await axios.get("https://openrouter.ai/api/v1/models")

		if (response.data?.data) {
			const rawModels = response.data.data
			const parsePrice = (price: any) => {
				if (price) {
					return parseFloat(price) * 1_000_000
				}
				return undefined
			}
			for (const rawModel of rawModels) {
				const modelInfo: Partial<OpenRouterModelInfo> = {
					maxTokens: rawModel.top_provider?.max_completion_tokens,
					contextWindow: rawModel.context_length,
					supportsImages: rawModel.architecture?.modality?.includes("image"),
					supportsPromptCache: false,
					inputPrice: parsePrice(rawModel.pricing?.prompt),
					outputPrice: parsePrice(rawModel.pricing?.completion),
					description: rawModel.description,
				}

				switch (rawModel.id) {
					case "anthropic/claude-sonnet-4":
					case "anthropic/claude-opus-4":
					case "anthropic/claude-3-7-sonnet":
					case "anthropic/claude-3-7-sonnet:beta":
					case "anthropic/claude-3.7-sonnet":
					case "anthropic/claude-3.7-sonnet:beta":
					case "anthropic/claude-3.7-sonnet:thinking":
					case "anthropic/claude-3.5-sonnet":
					case "anthropic/claude-3.5-sonnet:beta":
						// NOTE: this needs to be synced with api.ts/openrouter default model info
						modelInfo.supportsPromptCache = true
						modelInfo.cacheWritesPrice = 3.75
						modelInfo.cacheReadsPrice = 0.3
						break
					case "anthropic/claude-3.5-sonnet-20240620":
					case "anthropic/claude-3.5-sonnet-20240620:beta":
						modelInfo.supportsPromptCache = true
						modelInfo.cacheWritesPrice = 3.75
						modelInfo.cacheReadsPrice = 0.3
						break
					case "anthropic/claude-3-5-haiku":
					case "anthropic/claude-3-5-haiku:beta":
					case "anthropic/claude-3-5-haiku-20241022":
					case "anthropic/claude-3-5-haiku-20241022:beta":
					case "anthropic/claude-3.5-haiku":
					case "anthropic/claude-3.5-haiku:beta":
					case "anthropic/claude-3.5-haiku-20241022":
					case "anthropic/claude-3.5-haiku-20241022:beta":
						modelInfo.supportsPromptCache = true
						modelInfo.cacheWritesPrice = 1.25
						modelInfo.cacheReadsPrice = 0.1
						break
					case "anthropic/claude-3-opus":
					case "anthropic/claude-3-opus:beta":
						modelInfo.supportsPromptCache = true
						modelInfo.cacheWritesPrice = 18.75
						modelInfo.cacheReadsPrice = 1.5
						break
					case "anthropic/claude-3-haiku":
					case "anthropic/claude-3-haiku:beta":
						modelInfo.supportsPromptCache = true
						modelInfo.cacheWritesPrice = 0.3
						modelInfo.cacheReadsPrice = 0.03
						break
					case "deepseek/deepseek-chat":
						modelInfo.supportsPromptCache = true
						// see api.ts/deepSeekModels for more info
						modelInfo.inputPrice = 0
						modelInfo.cacheWritesPrice = 0.14
						modelInfo.cacheReadsPrice = 0.014
						break
					default:
						if (rawModel.id.startsWith("openai/")) {
							modelInfo.cacheReadsPrice = parsePrice(rawModel.pricing?.input_cache_read)
							if (modelInfo.cacheReadsPrice) {
								modelInfo.supportsPromptCache = true
								modelInfo.cacheWritesPrice = parsePrice(rawModel.pricing?.input_cache_write)
								// openrouter charges no cache write pricing for openAI models
							}
						} else if (rawModel.id.startsWith("google/")) {
							modelInfo.cacheReadsPrice = parsePrice(rawModel.pricing?.input_cache_read)
							if (modelInfo.cacheReadsPrice) {
								modelInfo.supportsPromptCache = true
								modelInfo.cacheWritesPrice = parsePrice(rawModel.pricing?.input_cache_write)
							}
						}
						break
				}

				models[rawModel.id] = modelInfo
			}
		} else {
			console.error("Invalid response from OpenRouter API")
		}
		await fs.writeFile(openRouterModelsFilePath, JSON.stringify(models))
		console.log("OpenRouter models fetched and saved", models)
	} catch (error) {
		console.error("Error fetching OpenRouter models:", error)

		// If we failed to fetch models, try to read cached models
		const cachedModels = await readOpenRouterModels(controller)
		if (cachedModels) {
			models = cachedModels
		}
	}

	// Convert the Record<string, Partial<OpenRouterModelInfo>> to Record<string, OpenRouterModelInfo>
	// by filling in any missing required fields with defaults
	const typedModels: Record<string, OpenRouterModelInfo> = {}
	for (const [key, model] of Object.entries(models)) {
		typedModels[key] = {
			maxTokens: model.maxTokens ?? 0,
			contextWindow: model.contextWindow ?? 0,
			supportsImages: model.supportsImages ?? false,
			supportsPromptCache: model.supportsPromptCache ?? false,
			inputPrice: model.inputPrice ?? 0,
			outputPrice: model.outputPrice ?? 0,
			cacheWritesPrice: model.cacheWritesPrice ?? 0,
			cacheReadsPrice: model.cacheReadsPrice ?? 0,
			description: model.description ?? "",
		}
	}

	return OpenRouterCompatibleModelInfo.create({ models: typedModels })
}

/**
 * Reads cached OpenRouter models from disk
 */
async function readOpenRouterModels(controller: Controller): Promise<Record<string, Partial<OpenRouterModelInfo>> | undefined> {
	const openRouterModelsFilePath = path.join(await ensureCacheDirectoryExists(controller), GlobalFileNames.openRouterModels)
	const fileExists = await fileExistsAtPath(openRouterModelsFilePath)
	if (fileExists) {
		try {
			const fileContents = await fs.readFile(openRouterModelsFilePath, "utf8")
			return JSON.parse(fileContents)
		} catch (error) {
			console.error("Error reading cached OpenRouter models:", error)
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

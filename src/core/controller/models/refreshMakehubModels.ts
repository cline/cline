import { Controller } from ".."
import { EmptyRequest } from "../../../shared/proto/common"
import { MakehubCompatibleModelInfo, MakehubModelInfo } from "../../../shared/proto/models"
import axios from "axios"
import path from "path"
import fs from "fs/promises"
import { fileExistsAtPath } from "@utils/fs"
import { GlobalFileNames } from "@core/storage/disk"
import { getSecret } from "@core/storage/state"

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
		const apiKey = await getSecret(controller.context, "makehubApiKey")
		if (!apiKey) {
			console.warn("MakeHub API key not found")
			// Try to read cached models
			const cachedModels = await readMakehubModels(controller)
			if (cachedModels) {
				models = cachedModels
			}
		} else {
			const response = await axios.get("https://api.makehub.ai/v1/models", {
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"HTTP-Referer": "https://cline.bot",
					"X-Title": "Cline",
				},
				timeout: 10000,
			})

			if (response.data?.data) {
				// Filter models with assistant_ready=true
				const filteredModels = response.data.data.filter((model: any) => model.assistant_ready)

				// Convert to ModelInfo format
				for (const rawModel of filteredModels) {
					const modelInfo: Partial<MakehubModelInfo> = {
						maxTokens: rawModel.max_tokens || 8192,
						contextWindow: rawModel.context,
						supportsImages: rawModel.supports_images ?? rawModel.capabilities?.image_input ?? false,
						supportsPromptCache: rawModel.supports_prompt_cache ?? false,
						inputPrice: rawModel.price_per_input_token ? rawModel.price_per_input_token : 0,
						outputPrice: rawModel.price_per_output_token ? rawModel.price_per_output_token : 0,
						cacheWritesPrice:
							rawModel.supports_prompt_cache && rawModel.cache_writes_price ? rawModel.cache_writes_price : 0,
						cacheReadsPrice:
							rawModel.supports_prompt_cache && rawModel.cache_reads_price ? rawModel.cache_reads_price : 0,
						description: rawModel.model_name || rawModel.model_id,
						displayName: rawModel.display_name || rawModel.model_id,
					}

					// Add thinking config if available
					if (rawModel.thinking_config) {
						modelInfo.thinkingConfig = {
							maxBudget: rawModel.thinking_config.max_budget,
							outputPrice: rawModel.thinking_config.output_price
								? rawModel.thinking_config.output_price
								: undefined,
						}
					}

					models[rawModel.model_id] = modelInfo
				}
			} else {
				console.error("Invalid response from MakeHub API")
			}

			await fs.writeFile(makehubModelsFilePath, JSON.stringify(models))
			console.log("MakeHub models fetched and saved", Object.keys(models).length, "models")
		}
	} catch (error) {
		console.error("Error fetching MakeHub models:", error)

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
			contextWindow: model.contextWindow ?? 8192,
			supportsImages: model.supportsImages ?? false,
			supportsPromptCache: model.supportsPromptCache ?? false,
			inputPrice: model.inputPrice ?? 0,
			outputPrice: model.outputPrice ?? 0,
			cacheWritesPrice: model.cacheWritesPrice ?? 0,
			cacheReadsPrice: model.cacheReadsPrice ?? 0,
			description: model.description ?? "",
			displayName: model.displayName ?? key,
			thinkingConfig: model.thinkingConfig,
		}
	}

	return MakehubCompatibleModelInfo.create({ models: typedModels })
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

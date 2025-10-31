import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { liteLlmModelInfoSaneDefaults, ModelInfo } from "@shared/api"
import { fileExistsAtPath } from "@utils/fs"
import fs from "fs/promises"
import path from "path"
import {
	fetchOpenAiCompatibleModels,
	normalizeOpenAiCompatibleBaseUrl,
} from "@/core/api/providers/shared/fetchOpenAiCompatibleModels"
import { Controller } from ".."

type LiteLlmModelResponseEntry = NonNullable<LiteLlmModelInfoResponse["data"]>[number]

interface LiteLlmModelInfoResponse {
	data?: Array<{
		model_name?: string
		description?: string
		litellm_params?: {
			model?: string
			max_tokens?: number
			context_window?: number
			supports_images?: boolean
			[key: string]: unknown
		}
		model_info?: {
			input_cost_per_token?: number | string
			output_cost_per_token?: number | string
			cache_creation_input_token_cost?: number | string
			cache_read_input_token_cost?: number | string
			supports_prompt_caching?: boolean
			[key: string]: unknown
		}
	}>
}

/**
 * Converts LiteLLM cost values (per-token) into price per million tokens.
 */
function convertCostToPerMillion(value?: number | string): number | undefined {
	if (value === undefined || value === null) {
		return undefined
	}
	const numericValue = typeof value === "number" ? value : parseFloat(value)
	if (Number.isNaN(numericValue)) {
		return undefined
	}
	return numericValue * 1_000_000
}

/**
 * Refreshes the LiteLLM models and returns application types.
 * @param controller The controller instance
 * @returns Record of model ID to ModelInfo (application types)
 */
export async function refreshLiteLlmModels(controller: Controller): Promise<Record<string, ModelInfo>> {
	const liteLlmModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.liteLlmModels)

	const liteLlmApiKey = controller.stateManager.getSecretKey("liteLlmApiKey")
	const rawBaseUrl = controller.stateManager.getGlobalSettingsKey("liteLlmBaseUrl")
	const normalizedBaseUrl = getNormalizedLiteLlmBaseUrl(rawBaseUrl)

	let models: Record<string, ModelInfo> = {}

	try {
		const headers: Record<string, string | undefined> = {
			"x-litellm-api-key": liteLlmApiKey,
			Authorization: liteLlmApiKey ? `Bearer ${liteLlmApiKey}` : undefined,
			"Content-Type": "application/json",
			"User-Agent": "Cline-VSCode-Extension",
		}

		const transformedModels = await fetchOpenAiCompatibleModels({
			baseUrl: normalizedBaseUrl,
			headers,
			transform: (rawModel: LiteLlmModelResponseEntry): Partial<ModelInfo> => {
				const modelInfo = rawModel.model_info ?? {}
				const params = rawModel.litellm_params ?? {}

				const partial: Partial<ModelInfo> = {}

				if (typeof params.max_tokens === "number") {
					partial.maxTokens = params.max_tokens
				}
				if (typeof params.context_window === "number") {
					partial.contextWindow = params.context_window
				}
				if (typeof params.supports_images === "boolean") {
					partial.supportsImages = params.supports_images
				}
				if (typeof modelInfo.supports_prompt_caching === "boolean") {
					partial.supportsPromptCache = modelInfo.supports_prompt_caching
				}

				const inputCost = convertCostToPerMillion(modelInfo.input_cost_per_token)
				if (inputCost !== undefined) {
					partial.inputPrice = inputCost
				}

				const outputCost = convertCostToPerMillion(modelInfo.output_cost_per_token)
				if (outputCost !== undefined) {
					partial.outputPrice = outputCost
				}

				const cacheWriteCost = convertCostToPerMillion(modelInfo.cache_creation_input_token_cost)
				if (cacheWriteCost !== undefined) {
					partial.cacheWritesPrice = cacheWriteCost
				}

				const cacheReadCost = convertCostToPerMillion(modelInfo.cache_read_input_token_cost)
				if (cacheReadCost !== undefined) {
					partial.cacheReadsPrice = cacheReadCost
				}

				if (rawModel.description) {
					partial.description = rawModel.description
				}

				return partial
			},
		})

		if (Object.keys(transformedModels).length > 0) {
			models = Object.fromEntries(
				Object.entries(transformedModels).map(([modelId, modelInfo]) => [
					modelId,
					{
						...liteLlmModelInfoSaneDefaults,
						...modelInfo,
					},
				]),
			)

			await fs.writeFile(liteLlmModelsFilePath, JSON.stringify(models))
		} else {
			console.warn("LiteLLM model list was empty; retaining previous cache if available.")
			const cachedModels = await readLiteLlmModels()
			if (cachedModels) {
				models = cachedModels
			}
		}
	} catch (error) {
		console.error("Error fetching LiteLLM models:", error)
		const cachedModels = await readLiteLlmModels()
		if (cachedModels) {
			models = cachedModels
		}
	}

	return models
}

/**
 * Reads cached LiteLLM models from disk (application types)
 */
async function readLiteLlmModels(): Promise<Record<string, ModelInfo> | undefined> {
	const liteLlmModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.liteLlmModels)
	if (await fileExistsAtPath(liteLlmModelsFilePath)) {
		try {
			const fileContents = await fs.readFile(liteLlmModelsFilePath, "utf8")
			return JSON.parse(fileContents) as Record<string, ModelInfo>
		} catch (error) {
			console.error("Error reading cached LiteLLM models:", error)
		}
	}
	return undefined
}

/**
 * Utility to resolve the effective LiteLLM base URL with default normalization.
 */
export function getNormalizedLiteLlmBaseUrl(baseUrl: string | undefined): string {
	return normalizeOpenAiCompatibleBaseUrl(baseUrl || "http://localhost:4000")
}

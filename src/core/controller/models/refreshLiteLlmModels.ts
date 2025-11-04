import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { LiteLLMModelInfo, liteLlmModelInfoSaneDefaults, ModelInfo } from "@shared/api"
import { fileExistsAtPath } from "@utils/fs"
import fs from "fs/promises"
import path from "path"
import {
	fetchOpenAiCompatibleModels,
	normalizeOpenAiCompatibleBaseUrl,
} from "@/core/api/providers/shared/fetchOpenAiCompatibleModels"
import { Controller } from ".."

type LiteLlmModelResponseEntry = NonNullable<LiteLlmModelInfoResponse["data"]>[number]

type LiteLlmTierInfo = {
	context_window?: number | string
	contextWindow?: number | string
	input_cost_per_token?: number | string
	output_cost_per_token?: number | string
	cache_creation_input_token_cost?: number | string
	cache_read_input_token_cost?: number | string
	inputPricePerToken?: number | string
	outputPricePerToken?: number | string
	cacheCreationCostPerToken?: number | string
	cacheReadCostPerToken?: number | string
	cacheWritesPrice?: number | string
	cacheReadsPrice?: number | string
	inputPrice?: number | string
	outputPrice?: number | string
}

type LiteLlmThinkingTierInfo = LiteLlmTierInfo

type LiteLlmThinkingConfig = {
	max_budget?: number | string
	maxBudget?: number | string
	output_cost_per_token?: number | string
	output_price_per_token?: number | string
	output_price?: number | string
	output_price_tiers?: LiteLlmThinkingTierInfo[]
}

interface LiteLlmModelInfoResponse {
	data?: Array<{
		model_name?: string
		description?: string
		context_window?: number
		max_completion_tokens?: number
		litellm_params?: {
			model?: string
			max_tokens?: number
			context_window?: number
			max_input_tokens?: number
			supports_images?: boolean
			[key: string]: unknown
		}
		model_info?: {
			input_cost_per_token?: number | string
			output_cost_per_token?: number | string
			cache_creation_input_token_cost?: number | string
			cache_creation_cost_per_token?: number | string
			cache_read_input_token_cost?: number | string
			cache_read_cost_per_token?: number | string
			supports_prompt_caching?: boolean
			supports_caching?: boolean
			supports_global_endpoint?: boolean
			supports_images?: boolean
			supports_vision?: boolean
			context_window?: number | string
			max_input_tokens?: number | string
			max_output_tokens?: number | string
			max_tokens?: number | string
			max_context_length?: number | string
			description?: string
			temperature?: number | string
			thinking_config?: LiteLlmThinkingConfig
			tiers?: LiteLlmTierInfo[]
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

				const parseNumber = (value: unknown): number | undefined => {
					if (typeof value === "number") {
						return Number.isFinite(value) ? value : undefined
					}
					if (typeof value === "string") {
						const parsed = Number(value)
						return Number.isFinite(parsed) ? parsed : undefined
					}
					return undefined
				}

				const partial: Partial<ModelInfo> = {}
				const liteLlmPartial = partial as Partial<LiteLLMModelInfo>

				const maxTokensFromParams = parseNumber(params.max_tokens)
				if (maxTokensFromParams !== undefined) {
					partial.maxTokens = maxTokensFromParams
				}

				const contextWindowFromParams = parseNumber(params.context_window)
				if (contextWindowFromParams !== undefined) {
					partial.contextWindow = contextWindowFromParams
				}

				if (typeof params.supports_images === "boolean") {
					partial.supportsImages = params.supports_images
				}

				const maxTokensFromInfo =
					parseNumber(modelInfo.max_output_tokens ?? modelInfo.max_tokens) ??
					parseNumber(rawModel.max_completion_tokens)
				if (partial.maxTokens === undefined && maxTokensFromInfo !== undefined) {
					partial.maxTokens = maxTokensFromInfo
				}

				const contextWindowFromInfo =
					parseNumber(
						modelInfo.context_window ??
							modelInfo.max_input_tokens ??
							modelInfo.max_tokens ??
							modelInfo.max_context_length,
					) ??
					parseNumber(rawModel.context_window) ??
					parseNumber(params.max_input_tokens)
				if (partial.contextWindow === undefined && contextWindowFromInfo !== undefined) {
					partial.contextWindow = contextWindowFromInfo
				}

				if (partial.supportsImages === undefined && typeof modelInfo.supports_images === "boolean") {
					partial.supportsImages = modelInfo.supports_images
				}
				if (partial.supportsImages === undefined && typeof modelInfo.supports_vision === "boolean") {
					partial.supportsImages = modelInfo.supports_vision
				}

				if (typeof modelInfo.supports_prompt_caching === "boolean") {
					partial.supportsPromptCache = modelInfo.supports_prompt_caching
				}
				if (typeof modelInfo.supports_caching === "boolean") {
					partial.supportsPromptCache = modelInfo.supports_caching
				}

				if (typeof modelInfo.supports_global_endpoint === "boolean") {
					partial.supportsGlobalEndpoint = modelInfo.supports_global_endpoint
				}

				const inputCost = convertCostToPerMillion(modelInfo.input_cost_per_token)
				if (inputCost !== undefined) {
					partial.inputPrice = inputCost
				}

				const outputCost = convertCostToPerMillion(modelInfo.output_cost_per_token)
				if (outputCost !== undefined) {
					partial.outputPrice = outputCost
				}

				const cacheWriteCost = convertCostToPerMillion(
					modelInfo.cache_creation_input_token_cost ?? modelInfo.cache_creation_cost_per_token,
				)
				if (cacheWriteCost !== undefined) {
					partial.cacheWritesPrice = cacheWriteCost
				}

				const cacheReadCost = convertCostToPerMillion(
					modelInfo.cache_read_input_token_cost ?? modelInfo.cache_read_cost_per_token,
				)
				if (cacheReadCost !== undefined) {
					partial.cacheReadsPrice = cacheReadCost
				}

				const temperature = parseNumber(modelInfo.temperature)
				if (temperature !== undefined) {
					liteLlmPartial.temperature = temperature
				}

				if (!partial.description) {
					if (typeof rawModel.description === "string" && rawModel.description.trim().length > 0) {
						partial.description = rawModel.description
					} else if (typeof modelInfo.description === "string" && modelInfo.description.trim().length > 0) {
						partial.description = modelInfo.description
					}
				}

				const thinkingConfig = modelInfo.thinking_config as LiteLlmThinkingConfig | undefined
				if (thinkingConfig && typeof thinkingConfig === "object") {
					const normalizedThinking: NonNullable<ModelInfo["thinkingConfig"]> = {}

					const maxBudget = parseNumber((thinkingConfig as any).max_budget ?? (thinkingConfig as any).maxBudget)
					if (maxBudget !== undefined) {
						normalizedThinking.maxBudget = maxBudget
					}

					const thinkingOutputPrice = convertCostToPerMillion(
						(thinkingConfig as any).output_cost_per_token ??
							(thinkingConfig as any).output_price_per_token ??
							(thinkingConfig as any).output_price,
					)
					if (thinkingOutputPrice !== undefined) {
						normalizedThinking.outputPrice = thinkingOutputPrice
					}

					if (Array.isArray(thinkingConfig.output_price_tiers)) {
						const tiers = thinkingConfig.output_price_tiers
							.map((tier: LiteLlmThinkingTierInfo) => {
								const contextWindow = parseNumber(tier.context_window ?? tier.contextWindow)
								if (contextWindow === undefined) {
									return undefined
								}
								const outputPrice = convertCostToPerMillion(
									tier.output_cost_per_token ?? tier.outputPricePerToken ?? tier.outputPrice,
								)
								if (outputPrice === undefined) {
									return undefined
								}
								return {
									tokenLimit: contextWindow,
									price: outputPrice,
								}
							})
							.filter((tier): tier is NonNullable<typeof tier> => Boolean(tier))

						if (tiers.length > 0) {
							normalizedThinking.outputPriceTiers = tiers
						}
					}

					if (Object.keys(normalizedThinking).length > 0) {
						partial.thinkingConfig = normalizedThinking
					}
				}

				if (Array.isArray(modelInfo.tiers)) {
					const tiers = modelInfo.tiers
						.map((tier: LiteLlmTierInfo) => {
							const contextWindow = parseNumber(tier.context_window ?? tier.contextWindow)
							if (contextWindow === undefined) {
								return undefined
							}
							return {
								contextWindow,
								inputPrice: convertCostToPerMillion(
									tier.input_cost_per_token ?? tier.inputPricePerToken ?? tier.inputPrice,
								),
								outputPrice: convertCostToPerMillion(
									tier.output_cost_per_token ?? tier.outputPricePerToken ?? tier.outputPrice,
								),
								cacheWritesPrice: convertCostToPerMillion(
									tier.cache_creation_input_token_cost ??
										tier.cacheCreationCostPerToken ??
										tier.cacheWritesPrice,
								),
								cacheReadsPrice: convertCostToPerMillion(
									tier.cache_read_input_token_cost ?? tier.cacheReadCostPerToken ?? tier.cacheReadsPrice,
								),
							}
						})
						.filter((tier): tier is NonNullable<typeof tier> => Boolean(tier))

					if (tiers.length > 0) {
						partial.tiers = tiers
					}
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

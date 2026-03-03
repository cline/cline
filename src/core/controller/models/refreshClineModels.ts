import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import type { ModelInfo } from "@shared/api"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import cloneDeep from "clone-deep"
import fs from "fs/promises"
import path from "path"
import { ClineEnv } from "@/config"
import { StateManager } from "@/core/storage/StateManager"
import { featureFlagsService } from "@/services/feature-flags"
import {
	ANTHROPIC_MAX_THINKING_BUDGET,
	CLAUDE_OPUS_1M_TIERS,
	CLAUDE_SONNET_1M_TIERS,
	openRouterClaudeOpus461mModelId,
	openRouterClaudeSonnet41mModelId,
	openRouterClaudeSonnet451mModelId,
	openRouterClaudeSonnet461mModelId,
} from "@/shared/api"
import { getAxiosSettings } from "@/shared/net"
import { FeatureFlag } from "@/shared/services/feature-flags/feature-flags"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."
import { refreshOpenRouterModels } from "./refreshOpenRouterModels"

type ClineSupportedParams =
	| "frequency_penalty"
	| "include_reasoning"
	| "logit_bias"
	| "logprobs"
	| "max_tokens"
	| "min_p"
	| "presence_penalty"
	| "reasoning"
	| "repetition_penalty"
	| "response_format"
	| "seed"
	| "stop"
	| "temperature"
	| "tool_choice"
	| "tools"
	| "top_k"
	| "top_logprobs"
	| "top_p"

/**
 * The raw model information returned by the Cline API to list models
 */
interface ClineRawModelInfo {
	id: string
	name: string
	description: string | null
	context_length: number | null
	top_provider: {
		max_completion_tokens: number | null
		context_length: number | null
		is_moderated: boolean | null
	} | null
	architecture: {
		modality: string | string[]
		input_modalities?: string[]
		output_modalities?: string[]
		tokenizer?: string
		instruct_type?: string
	} | null
	pricing: {
		prompt: string
		completion: string
		request?: string
		image?: string
		audio?: string
		web_search?: string
		internal_reasoning?: string
		input_cache_read?: string
		input_cache_write?: string
	} | null
	supports_global_endpoint?: boolean | null
	tiers?: any[] | null
	supported_parameters?: ClineSupportedParams[] | null
}

// Track pending refresh promise to prevent duplicate concurrent fetches
let pendingRefresh: Promise<Record<string, ModelInfo>> | null = null

async function fetchRawClineModels(): Promise<ClineRawModelInfo[]> {
	const apiBaseUrl = ClineEnv.config().apiBaseUrl
	const response = await axios.get(`${apiBaseUrl}/api/v1/ai/cline/models`, getAxiosSettings())

	if (!Array.isArray(response.data?.data)) {
		throw new Error("Invalid response data when fetching Cline models")
	}

	Logger.log("Cline models source: Cline API")
	return response.data.data as ClineRawModelInfo[]
}

/**
 * Core function: Refreshes the Cline models and returns application types
 * @param controller The controller instance
 * @returns Record of model ID to ModelInfo (application types)
 */
export async function refreshClineModels(controller: Controller): Promise<Record<string, ModelInfo>> {
	const shouldUseClineEndpointSource = featureFlagsService.getBooleanFlagEnabled(FeatureFlag.EXTENSION_CLINE_MODELS_ENDPOINT)
	if (!shouldUseClineEndpointSource) {
		return refreshOpenRouterModels(controller)
	}

	// Check in-memory cache first
	const cache = StateManager.get().getModelsCache("cline")
	if (cache) {
		return cache
	}

	// If a fetch is already in progress, return the same promise
	if (pendingRefresh) {
		return pendingRefresh
	}

	// Start new fetch and track the promise
	pendingRefresh = (async () => {
		try {
			return await fetchAndCacheClineModels()
		} finally {
			// Clear pending promise when done (success or error)
			pendingRefresh = null
		}
	})()

	return pendingRefresh
}

async function fetchAndCacheClineModels(): Promise<Record<string, ModelInfo>> {
	const clineModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.clineModels)

	let models: Record<string, ModelInfo> = {}
	try {
		const rawModels = await fetchRawClineModels()
		const parsePrice = (price: any) => {
			if (price === undefined || price === null || price === "") {
				return undefined
			}

			const parsedPrice = Number.parseFloat(String(price))
			return Number.isNaN(parsedPrice) ? undefined : parsedPrice * 1_000_000
		}
		for (const rawModel of rawModels) {
			const supportThinking = rawModel.supported_parameters?.some((p) => p === "include_reasoning" || p === "reasoning")

			// Handle modality which can be a string or array
			const modality = rawModel.architecture?.modality
			const supportsImages = Array.isArray(modality)
				? modality.includes("image")
				: typeof modality === "string" && modality.includes("image")

			const modelInfo: ModelInfo = {
				name: rawModel.name,
				maxTokens: rawModel.top_provider?.max_completion_tokens ?? 0,
				contextWindow: rawModel.context_length ?? 0,
				supportsImages,
				supportsPromptCache: false,
				inputPrice: parsePrice(rawModel.pricing?.prompt) ?? 0,
				outputPrice: parsePrice(rawModel.pricing?.completion) ?? 0,
				cacheWritesPrice: parsePrice(rawModel.pricing?.input_cache_write),
				cacheReadsPrice: parsePrice(rawModel.pricing?.input_cache_read),
				description: rawModel.description ?? "",
				// If thinking is supported, set maxBudget with a default value as a placeholder
				// to ensure it has a valid thinkingConfig that lets the application know thinking is supported.
				thinkingConfig: supportThinking ? { maxBudget: ANTHROPIC_MAX_THINKING_BUDGET } : undefined,
				supportsGlobalEndpoint: rawModel.supports_global_endpoint ?? undefined,
				tiers: rawModel.tiers ?? undefined,
			}

			// Apply model-specific overrides for known models
			switch (rawModel.id) {
				case "anthropic/claude-sonnet-4.6":
				case "anthropic/claude-4.6-sonnet":
				case "anthropic/claude-sonnet-4.5":
				case "anthropic/claude-4.5-sonnet":
				case "anthropic/claude-sonnet-4":
					modelInfo.contextWindow = 200_000
					modelInfo.supportsPromptCache = true
					modelInfo.cacheWritesPrice = 3.75
					modelInfo.cacheReadsPrice = 0.3
					break
				case "anthropic/claude-3-7-sonnet":
				case "anthropic/claude-3.7-sonnet":
				case "anthropic/claude-3.5-sonnet":
					modelInfo.supportsPromptCache = true
					modelInfo.cacheWritesPrice = 3.75
					modelInfo.cacheReadsPrice = 0.3
					break
				case "anthropic/claude-opus-4.6":
					modelInfo.contextWindow = 200_000
					modelInfo.supportsPromptCache = true
					modelInfo.cacheWritesPrice = 6.25
					modelInfo.cacheReadsPrice = 0.5
					break
				case "anthropic/claude-opus-4.5":
					modelInfo.supportsPromptCache = true
					modelInfo.cacheWritesPrice = 6.25
					modelInfo.cacheReadsPrice = 0.5
					break
				case "anthropic/claude-opus-4.1":
				case "anthropic/claude-opus-4":
					modelInfo.supportsPromptCache = true
					modelInfo.cacheWritesPrice = 18.75
					modelInfo.cacheReadsPrice = 1.5
					break
				case "anthropic/claude-haiku-4.5":
				case "anthropic/claude-4.5-haiku":
				case "anthropic/claude-3-5-haiku":
				case "anthropic/claude-3.5-haiku":
					modelInfo.supportsPromptCache = true
					modelInfo.cacheWritesPrice = 1.25
					modelInfo.cacheReadsPrice = 0.1
					break
				case "deepseek/deepseek-chat":
					modelInfo.supportsPromptCache = true
					modelInfo.inputPrice = 0
					modelInfo.cacheWritesPrice = 0.14
					modelInfo.cacheReadsPrice = 0.014
					break
				case "openai/gpt-5":
				case "openai/gpt-5-chat":
				case "openai/gpt-5-mini":
				case "openai/gpt-5-nano":
					modelInfo.maxTokens = 8_192
					modelInfo.contextWindow = 272_000
					break
				default:
					// Check for cache pricing from the API response
					if (rawModel.id.startsWith("openai/") || rawModel.id.startsWith("google/")) {
						const cacheReadPrice = parsePrice(rawModel.pricing?.input_cache_read)
						modelInfo.cacheReadsPrice = cacheReadPrice
						if (cacheReadPrice !== undefined) {
							modelInfo.supportsPromptCache = true
							modelInfo.cacheWritesPrice = parsePrice(rawModel.pricing?.input_cache_write)
						}
					}
					break
			}

			models[rawModel.id] = modelInfo

			// Add custom :1m model variant for Sonnet models
			if (
				rawModel.id === "anthropic/claude-sonnet-4" ||
				rawModel.id === "anthropic/claude-sonnet-4.5" ||
				rawModel.id === "anthropic/claude-sonnet-4.6" ||
				rawModel.id === "anthropic/claude-4.6-sonnet"
			) {
				const claudeSonnet1mModelInfo = cloneDeep(modelInfo)
				claudeSonnet1mModelInfo.contextWindow = 1_000_000
				claudeSonnet1mModelInfo.tiers = CLAUDE_SONNET_1M_TIERS

				if (rawModel.id === "anthropic/claude-sonnet-4") {
					models[openRouterClaudeSonnet41mModelId] = claudeSonnet1mModelInfo
				}
				if (rawModel.id === "anthropic/claude-sonnet-4.5") {
					models[openRouterClaudeSonnet451mModelId] = claudeSonnet1mModelInfo
				}
				if (rawModel.id === "anthropic/claude-sonnet-4.6" || rawModel.id === "anthropic/claude-4.6-sonnet") {
					models[openRouterClaudeSonnet461mModelId] = claudeSonnet1mModelInfo
				}
			}

			// Add custom :1m model variant for Opus 4.6
			if (rawModel.id === "anthropic/claude-opus-4.6") {
				const claudeOpus1mModelInfo = cloneDeep(modelInfo)
				claudeOpus1mModelInfo.contextWindow = 1_000_000
				claudeOpus1mModelInfo.tiers = CLAUDE_OPUS_1M_TIERS
				models[openRouterClaudeOpus461mModelId] = claudeOpus1mModelInfo
			}
		}
		if (Object.keys(models).length === 0) {
			throw new Error("No Cline models returned from API")
		}
		// Save models and cache them in memory
		await fs.writeFile(clineModelsFilePath, JSON.stringify(models))
		Logger.log("Cline models fetched and saved")
	} catch (error) {
		Logger.error("Error fetching Cline models:", error)

		// If we failed to fetch models, try to read cached models from disk
		try {
			const fileExists = await fileExistsAtPath(clineModelsFilePath)
			if (fileExists) {
				const fileContents = await fs.readFile(clineModelsFilePath, "utf8")
				models = JSON.parse(fileContents)
				Logger.log("Loaded Cline models from cache")
			}
		} catch (cacheError) {
			Logger.error("Error reading Cline models from cache:", cacheError)
		}
	}

	// Avoid poisoning in-memory cache with an empty model map after transient failures.
	if (Object.keys(models).length > 0) {
		StateManager.get().setModelsCache("cline", models)
	}

	return models
}

/**
 * Read cached Cline models from disk
 * @returns The cached models or undefined if not found
 */
export async function readClineModelsFromCache(): Promise<Record<string, ModelInfo> | undefined> {
	try {
		const clineModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.clineModels)
		const fileExists = await fileExistsAtPath(clineModelsFilePath)
		if (fileExists) {
			const fileContents = await fs.readFile(clineModelsFilePath, "utf8")
			return JSON.parse(fileContents)
		}
	} catch (error) {
		Logger.error("Error reading Cline models from cache:", error)
	}
	return undefined
}

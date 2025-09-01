import { GlobalFileNames } from "@core/storage/disk"
import { EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo, OpenRouterModelInfo } from "@shared/proto/cline/models"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import cloneDeep from "clone-deep"
import fs from "fs/promises"
import path from "path"
import { CLAUDE_SONNET_4_1M_TIERS, clineMicrowaveAlphaModelInfo, openRouterClaudeSonnet41mModelId } from "@/shared/api"
import { Controller } from ".."

type OpenRouterSupportedParams =
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
 * The raw model information returned by the OpenRouter API to list models
 * @link https://openrouter.ai/docs/overview/models
 */
interface OpenRouterRawModelInfo {
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
		modality: string[]
		input_modalities: string[]
		output_modalities: string[]
		tokenizer: string
		instruct_type: string
	} | null
	pricing: {
		prompt: string
		completion: string
		request: string
		image: string
		audio: string
		web_search: string
		internal_reasoning: string
		input_cache_read: string
		input_cache_write: string
	} | null
	thinking_config: any | null
	supports_global_endpoint: boolean | null
	tiers: any[] | null
	supported_parameters?: OpenRouterSupportedParams[] | null
}

/**
 * Refreshes the OpenRouter models and returns the updated model listhttps://openrouter.ai/docs/overview/models
 * @param controller The controller instance
 * @param request Empty request object
 * @returns Response containing the OpenRouter models
 */
export async function refreshOpenRouterModels(
	controller: Controller,
	_request: EmptyRequest,
): Promise<OpenRouterCompatibleModelInfo> {
	const openRouterModelsFilePath = path.join(await ensureCacheDirectoryExists(controller), GlobalFileNames.openRouterModels)

	let models: Record<string, OpenRouterModelInfo> = {}
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
			for (const rawModel of rawModels as OpenRouterRawModelInfo[]) {
				const supportThinking = rawModel.supported_parameters?.some((p) => p === "include_reasoning")
				const modelInfo = OpenRouterModelInfo.create({
					maxTokens: rawModel.top_provider?.max_completion_tokens ?? 0,
					contextWindow: rawModel.context_length ?? 0,
					supportsImages: rawModel.architecture?.modality?.includes("image") ?? false,
					supportsPromptCache: false,
					inputPrice: parsePrice(rawModel.pricing?.prompt) ?? 0,
					outputPrice: parsePrice(rawModel.pricing?.completion) ?? 0,
					cacheWritesPrice: parsePrice(rawModel.pricing?.input_cache_write),
					cacheReadsPrice: parsePrice(rawModel.pricing?.input_cache_read),
					description: rawModel.description ?? "",
					thinkingConfig: supportThinking ? (rawModel.thinking_config ?? {}) : undefined,
					supportsGlobalEndpoint: rawModel.supports_global_endpoint ?? undefined,
					tiers: rawModel.tiers ?? [],
				})

				switch (rawModel.id) {
					case "anthropic/claude-sonnet-4":
						// NOTE: we artificially restrict the context window to 200k to keep costs low for users, and have a :1m model variant created below for users that want to use the full 1m.
						modelInfo.contextWindow = 200_000
						modelInfo.supportsPromptCache = true
						modelInfo.cacheWritesPrice = 3.75
						modelInfo.cacheReadsPrice = 0.3
						break
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
					case "anthropic/claude-opus-4.1":
					case "anthropic/claude-opus-4":
						modelInfo.supportsPromptCache = true
						modelInfo.cacheWritesPrice = 18.75
						modelInfo.cacheReadsPrice = 1.5
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
					case "x-ai/grok-3-beta":
						modelInfo.supportsPromptCache = true
						modelInfo.cacheWritesPrice = 0.75
						modelInfo.cacheReadsPrice = 0
						break
					case "moonshotai/kimi-k2":
						// forcing kimi-k2 to use the together provider for full context and best throughput
						modelInfo.inputPrice = 1
						modelInfo.outputPrice = 3
						modelInfo.contextWindow = 131_000
						break
					case "openai/gpt-5":
					case "openai/gpt-5-chat":
					case "openai/gpt-5-mini":
					case "openai/gpt-5-nano":
						modelInfo.maxTokens = 8_192 // 128000 breaks context window truncation
						modelInfo.contextWindow = 272_000 // openrouter reports 400k but the input limit is actually 400k-128k
						break
					case "x-ai/grok-code-fast-1":
						modelInfo.supportsPromptCache = true
						modelInfo.cacheReadsPrice = 0.02
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

				// add custom :1m model variant
				if (rawModel.id === "anthropic/claude-sonnet-4") {
					const claudeSonnet41mModelInfo = cloneDeep(modelInfo)
					claudeSonnet41mModelInfo.contextWindow = 1_000_000 // limiting providers to those that support 1m context window
					claudeSonnet41mModelInfo.tiers = CLAUDE_SONNET_4_1M_TIERS
					models[openRouterClaudeSonnet41mModelId] = claudeSonnet41mModelInfo
				}
			}

			// Add hardcoded cline/sonic model
			models["cline/sonic"] = OpenRouterModelInfo.create({
				maxTokens: clineMicrowaveAlphaModelInfo.maxTokens ?? 0,
				contextWindow: clineMicrowaveAlphaModelInfo.contextWindow ?? 0,
				supportsImages: clineMicrowaveAlphaModelInfo.supportsImages ?? false,
				supportsPromptCache: clineMicrowaveAlphaModelInfo.supportsPromptCache ?? false,
				inputPrice: clineMicrowaveAlphaModelInfo.inputPrice ?? 0,
				outputPrice: clineMicrowaveAlphaModelInfo.outputPrice ?? 0,
				cacheWritesPrice: clineMicrowaveAlphaModelInfo.cacheWritesPrice ?? 0,
				cacheReadsPrice: clineMicrowaveAlphaModelInfo.cacheReadsPrice ?? 0,
				description: clineMicrowaveAlphaModelInfo.description ?? "",
				thinkingConfig: clineMicrowaveAlphaModelInfo.thinkingConfig ?? undefined,
				supportsGlobalEndpoint: clineMicrowaveAlphaModelInfo.supportsGlobalEndpoint ?? undefined,
				tiers: clineMicrowaveAlphaModelInfo.tiers ?? [],
			})
		} else {
			console.error("Invalid response from OpenRouter API")
		}
		await fs.writeFile(openRouterModelsFilePath, JSON.stringify(models))
		console.log("OpenRouter models fetched and saved", JSON.stringify(models).slice(0, 300))
	} catch (error) {
		console.error("Error fetching OpenRouter models:", error)

		// If we failed to fetch models, try to read cached models
		const cachedModels = await readOpenRouterModels(controller)
		if (cachedModels) {
			models = cachedModels
		}
	}

	return OpenRouterCompatibleModelInfo.create({ models })
}

/**
 * Reads cached OpenRouter models from disk
 */
async function readOpenRouterModels(controller: Controller): Promise<Record<string, OpenRouterModelInfo> | undefined> {
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

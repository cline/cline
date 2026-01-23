import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { ModelInfo } from "@shared/api"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Derives thinkingConfig from model ID and tags.
 * The Vercel API only provides a "reasoning" tag to indicate support,
 * so we derive the specific configuration based on model patterns.
 */
function deriveThinkingConfig(modelId: string, tags?: string[]): ModelInfo["thinkingConfig"] {
	if (!tags?.includes("reasoning")) {
		return undefined
	}

	// Anthropic Claude models
	if (modelId.startsWith("anthropic/claude")) {
		return { maxBudget: 8192 }
	}

	// Google Gemini models
	if (modelId.includes("gemini-3")) {
		return {
			maxBudget: 32767,
			supportsThinkingLevel: true,
			geminiThinkingLevel: "high",
		}
	}

	// DeepSeek R1 models
	if (modelId.startsWith("deepseek/deepseek-r1")) {
		return { maxBudget: 8192 }
	}

	// OpenAI o-series reasoning models
	if (modelId.startsWith("openai/o1") || modelId.startsWith("openai/o3")) {
		return { maxBudget: 32000 }
	}

	// Qwen QwQ models (specific IDs to match OpenRouter)
	if (modelId === "qwen/qwq-32b:free" || modelId === "qwen/qwq-32b") {
		return { maxBudget: 32000 }
	}

	// Default for other reasoning models
	return { maxBudget: 32000 }
}

/**
 * Derives recommended temperature for specific model types.
 * Returns undefined to use the default (0).
 */
function deriveTemperature(modelId: string): number | undefined {
	// DeepSeek R1 and similar reasoning models recommend 0.7
	// Use specific model IDs to match OpenRouter behavior
	if (
		modelId.startsWith("deepseek/deepseek-r1") ||
		modelId === "perplexity/sonar-reasoning" ||
		modelId === "qwen/qwq-32b:free" ||
		modelId === "qwen/qwq-32b"
	) {
		return 0.7
	}

	// Gemini 3.0 recommends temperature 1.0
	if (modelId.startsWith("google/gemini-3.0") || modelId === "google/gemini-3.0") {
		return 1.0
	}

	return undefined
}

/**
 * Core function: Refreshes Vercel AI Gateway models and returns application types
 * @param _controller The controller instance (unused)
 * @returns Record of model ID to ModelInfo (application types)
 */
export async function refreshVercelAiGatewayModels(_controller: Controller): Promise<Record<string, ModelInfo>> {
	const vercelAiGatewayModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.vercelAiGatewayModels)

	let models: Record<string, ModelInfo> = {}

	try {
		const response = await axios.get("https://ai-gateway.vercel.sh/v1/models?include_mappings=true", getAxiosSettings())

		if (response.data?.data) {
			const rawModels = response.data.data
			const parsePrice = (price: any) => {
				if (price) {
					return parseFloat(price) * 1_000_000
				}
				return undefined
			}

			for (const rawModel of rawModels) {
				if (rawModel.type === "embedding") {
					continue
				}

				const modelInfo: ModelInfo = {
					maxTokens: rawModel.max_tokens ?? 0,
					contextWindow: rawModel.context_window ?? 0,
					inputPrice: parsePrice(rawModel.pricing?.input) ?? 0,
					outputPrice: parsePrice(rawModel.pricing?.output) ?? 0,
					cacheWritesPrice: parsePrice(rawModel.pricing?.input_cache_write) ?? 0,
					cacheReadsPrice: parsePrice(rawModel.pricing?.input_cache_read) ?? 0,
					supportsImages: true, // assume all models support images since vercel ai doesn't give this info
					supportsPromptCache: !!(rawModel.pricing?.input_cache_read && rawModel.pricing?.input_cache_write),
					description: rawModel.description ?? "",
					thinkingConfig: deriveThinkingConfig(rawModel.id, rawModel.tags),
					temperature: deriveTemperature(rawModel.id),
				}

				models[rawModel.id] = modelInfo
			}

			await fs.writeFile(vercelAiGatewayModelsFilePath, JSON.stringify(models))
			Logger.log("Vercel AI Gateway models fetched and saved", JSON.stringify(models).slice(0, 300))
		} else {
			Logger.error("Invalid response from Vercel AI Gateway API")
		}
	} catch (error) {
		Logger.error("Error fetching Vercel AI Gateway models:", error)

		// If we failed to fetch models, try to read cached models
		const cachedModels = await readVercelAiGatewayModels()
		if (cachedModels) {
			models = cachedModels
		}
	}

	return models
}

/**
 * Reads cached Vercel AI Gateway models from disk (application types)
 */
async function readVercelAiGatewayModels(): Promise<Record<string, ModelInfo> | undefined> {
	const vercelAiGatewayModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.vercelAiGatewayModels)
	const fileExists = await fileExistsAtPath(vercelAiGatewayModelsFilePath)
	if (fileExists) {
		try {
			const fileContents = await fs.readFile(vercelAiGatewayModelsFilePath, "utf8")
			return JSON.parse(fileContents)
		} catch (error) {
			Logger.error("Error reading cached Vercel AI Gateway models:", error)
			return undefined
		}
	}
	return undefined
}

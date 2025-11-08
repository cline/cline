import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { ModelInfo } from "@shared/api"
import { fileExistsAtPath } from "@utils/fs"
import fs from "fs/promises"
import path from "path"
import { Controller } from ".."

interface VercelAiGatewayRawModelInfo {
	id: string
	name: string
	object: "model"
	created: number
	owned_by: string // e.g amazon, google, anthropic, openai, etc.
	description: string | null
	context_window: number | null
	max_tokens: number | null
	type: "embedding" | "language" | string
	tags?: ("file-input" | "reasoning" | "implicit-caching" | "tool-use" | "vision" | "image-generation" | string)[]
	pricing?: {
		input?: string | null
		output?: string | null
		input_cache_read?: string | null
		input_cache_write?: string | null
	} | null
}

const VERCEL_AI_GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models"

/**
 * Core function: Refreshes Vercel AI Gateway models and returns application types
 * @param _controller The controller instance (unused)
 * @returns Record of model ID to ModelInfo (application types)
 */
export async function refreshVercelAiGatewayModels(_controller: Controller): Promise<Record<string, ModelInfo>> {
	const vercelAiGatewayModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.vercelAiGatewayModels)

	const models: Record<string, ModelInfo> | undefined = (await readVercelAiGatewayModels()) || {}

	try {
		const response = await fetch(VERCEL_AI_GATEWAY_MODELS_URL, {
			method: "GET",
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Vercel Gateway error: ${response.status} ${response.statusText} - ${errorText}`)
		}

		const data = await response.json()

		const rawModels = data?.data as VercelAiGatewayRawModelInfo[]

		for (const raw of rawModels) {
			if (raw.type !== "language") {
				continue
			}

			const modelInfo: ModelInfo = {
				maxTokens: raw.max_tokens ?? 0,
				contextWindow: raw.context_window ?? 0,
				inputPrice: parsePrice(raw.pricing?.input),
				outputPrice: parsePrice(raw.pricing?.output),
				cacheWritesPrice: parsePrice(raw.pricing?.input_cache_write),
				cacheReadsPrice: parsePrice(raw.pricing?.input_cache_read),
				supportsImages: raw.tags?.some((tag) => tag === "vision") ?? false,
				supportsPromptCache: raw.tags?.some((tag) => tag === "implicit-caching") ?? false,
				description: raw.description ?? `${raw.name} by ${raw.owned_by}`,
			}

			if (modelInfo.cacheReadsPrice || modelInfo.cacheWritesPrice) {
				modelInfo.supportsPromptCache = true
			}

			if (modelInfo.maxTokens && raw.tags?.some((tag) => tag === "reasoning")) {
				modelInfo.thinkingConfig = {
					// Allocate max 20% of max tokens for reasoning/thinking
					maxBudget: modelInfo.maxTokens * 0.2,
				}
			}

			models[raw.id] = modelInfo
		}

		try {
			await fs.writeFile(vercelAiGatewayModelsFilePath, JSON.stringify(models))
			console.log("Vercel AI Gateway models fetched and saved", JSON.stringify(models).slice(0, 300))
		} catch {
			throw new Error("Failed to write Vercel AI Gateway models to disk")
		}
		return models
	} catch (error) {
		console.error("Error fetching Vercel AI Gateway models:", error)
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
			console.error("Error reading cached Vercel AI Gateway models:", error)
			return undefined
		}
	}
	return undefined
}

const parsePrice = (price?: string | null) => {
	return price !== null && price !== undefined ? parseFloat(price) * 1_000_000 : undefined
}

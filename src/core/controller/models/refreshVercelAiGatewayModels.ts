import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { ModelInfo } from "@shared/api"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { getAxiosSettings } from "@/shared/net"
import { Controller } from ".."

/**
 * Core function: Refreshes Vercel AI Gateway models and returns application types
 * @param _controller The controller instance (unused)
 * @returns Record of model ID to ModelInfo (application types)
 */
export async function refreshVercelAiGatewayModels(_controller: Controller): Promise<Record<string, ModelInfo>> {
	const vercelAiGatewayModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.vercelAiGatewayModels)

	let models: Record<string, ModelInfo> = {}

	try {
		const response = await axios.get("https://ai-gateway.vercel.sh/v1/models", getAxiosSettings())

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
				}

				models[rawModel.id] = modelInfo
			}

			await fs.writeFile(vercelAiGatewayModelsFilePath, JSON.stringify(models))
			console.log("Vercel AI Gateway models fetched and saved", JSON.stringify(models).slice(0, 300))
		} else {
			console.error("Invalid response from Vercel AI Gateway API")
		}
	} catch (error) {
		console.error("Error fetching Vercel AI Gateway models:", error)

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
			console.error("Error reading cached Vercel AI Gateway models:", error)
			return undefined
		}
	}
	return undefined
}

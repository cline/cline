import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { ModelInfo } from "@shared/api"
import fs from "fs/promises"
import path from "path"
import { Controller } from ".."
import { refreshOpenRouterModels } from "./refreshOpenRouterModels"
import { refreshVercelAiGatewayModels } from "./refreshVercelAiGatewayModels"

type SupportedProviders = "openRouter" | "vercel_ai_gateway" | "cline"

interface ModelCache {
	provider: SupportedProviders
	models: Record<string, ModelInfo> | undefined
	filePath: string | undefined
	lastUpdated?: number | undefined
	isRefreshing: boolean
}

const cache: ModelCache = {
	provider: "openRouter", // Could be controlled by feature flag later
	models: undefined,
	filePath: undefined,
	lastUpdated: undefined,
	isRefreshing: false,
}

/**
 * Stealth models are models that are compatible with the OpenRouter API but not listed on the OpenRouter website or API.
 */
const CLINE_STEALTH_MODELS: Record<string, ModelInfo> = {
	// Add more stealth models here as needed
	// Right now this list is empty as the latest stealth model was removed
}

/**
 * NOTE: WIP - This function is intended to eventually make swapping between multiple Cline-compatible model providers easier.
 * Core function: Refreshes Cline models from specified provider and returns application types
 * @param controller The controller instance (unused)
 * @param provider The model provider to refresh from the current provider
 * @returns Record of model ID to ModelInfo (application types)
 */
export async function refreshClineModels(controller: Controller): Promise<Record<string, ModelInfo>> {
	cache.isRefreshing = true
	let models: Record<string, ModelInfo> = {}
	try {
		if (cache.provider === "openRouter") {
			models = await refreshOpenRouterModels(controller)
		} else if (cache.provider === "vercel_ai_gateway") {
			models = await refreshVercelAiGatewayModels(controller)
		}
	} catch (error) {
		console.error("Error fetching Cline models:", error)
	}

	if (models && Object.keys(models).length > 0) {
		try {
			cache.models = appendClineStealthModels(models)
			// The refresh model function has already stored the models to disk
			// const filePath = await getFilePath()
			// await fs.writeFile(filePath, JSON.stringify(cache.models))
			console.log("Cline models fetched and saved", JSON.stringify(models).slice(0, 300))
		} catch {
			throw new Error("Failed to write Cline models to disk")
		}
	}

	cache.isRefreshing = false

	return cache.models || (await getClineCachedModels()) || {}
}

// Get the file path based on the current provider
async function getFilePath() {
	if (!cache.filePath) {
		const cacheDir = await ensureCacheDirectoryExists()
		switch (cache.provider) {
			case "vercel_ai_gateway":
				cache.filePath = path.join(cacheDir, GlobalFileNames.vercelAiGatewayModels)
				break
			case "openRouter":
				cache.filePath = path.join(cacheDir, GlobalFileNames.openRouterModels)
				break
			case "cline":
				cache.filePath = path.join(cacheDir, GlobalFileNames.clineModelsCache)
		}
	}
	return cache.filePath
}

/**
 * Reads cached Cline models from disk (application types)
 */
export async function getClineCachedModels(): Promise<Record<string, ModelInfo> | undefined> {
	if (!cache.models && !cache.isRefreshing && !cache.filePath) {
		try {
			const filePath = await getFilePath()
			if (filePath) {
				cache.filePath = filePath

				const content = await fs.readFile(filePath, "utf8")
				const models = JSON.parse(content)
				cache.models = models
			}
		} catch (error) {
			console.error("Error reading cached Cline models:", error)
		}
	}

	return appendClineStealthModels(cache.models || {})
}

export function appendClineStealthModels(currentModels: Record<string, ModelInfo>): Record<string, ModelInfo> {
	// Create a shallow clone of the current models to avoid mutating the original object
	const cloned = { ...currentModels }
	for (const [modelId, modelInfo] of Object.entries(CLINE_STEALTH_MODELS)) {
		if (!cloned[modelId]) {
			cloned[modelId] = modelInfo
		}
	}
	return cloned
}

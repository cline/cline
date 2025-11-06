import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { ModelInfo } from "@shared/api"
import fs from "fs/promises"
import path from "path"
import { fileExistsAtPath } from "@/utils/fs"
import { Controller } from ".."
import { refreshOpenRouterModels } from "./refreshOpenRouterModels"
import { refreshVercelAiGatewayModels } from "./refreshVercelAiGatewayModels"

interface ModelCache {
	models: Record<string, ModelInfo> | undefined
	filePath: string | undefined
	lastUpdated?: number | undefined
	isRefreshing: boolean
}

const cache: ModelCache = { models: undefined, filePath: undefined, lastUpdated: undefined, isRefreshing: false }

type SupportedProviders = "openrouter" | "vercel_ai_gateway"

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
 * @param provider The model provider to refresh from ("openrouter" or "vercel_ai_gateway")
 * @returns Record of model ID to ModelInfo (application types)
 */
export async function refreshClineModels(
	controller: Controller,
	provider: SupportedProviders = "openrouter", // Could be controlled by feature flag later
): Promise<Record<string, ModelInfo>> {
	cache.isRefreshing = true
	let models: Record<string, ModelInfo> = {}
	try {
		if (provider === "openrouter") {
			models = await refreshOpenRouterModels(controller)
		} else if (provider === "vercel_ai_gateway") {
			models = await refreshVercelAiGatewayModels(controller)
		}
	} catch (error) {
		console.error("Error fetching Cline models:", error)
	}

	if (models && Object.keys(models).length > 0) {
		try {
			cache.models = appendClineStealthModels(models)
			const filePath = await getFilePath()
			await fs.writeFile(filePath, JSON.stringify(cache.models))
			console.log("Vercel AI Gateway models fetched and saved", JSON.stringify(models).slice(0, 300))
		} catch {
			throw new Error("Failed to write Vercel AI Gateway models to disk")
		}
	}

	cache.isRefreshing = false

	return cache.models || (await getClineCachedModels()) || {}
}

async function getFilePath() {
	if (!cache.filePath) {
		const path = await migrateModelProviderCache()
		cache.filePath = path
	}

	return cache.filePath
}

/**
 * Reads cached Vercel AI Gateway models from disk (application types)
 */
export async function getClineCachedModels(): Promise<Record<string, ModelInfo> | undefined> {
	if (!cache.models && !cache.isRefreshing && !cache.filePath) {
		try {
			const filePath = await migrateModelProviderCache()
			if (filePath) {
				cache.filePath = filePath

				const content = await fs.readFile(filePath, "utf8")
				const models = JSON.parse(content)
				cache.models = appendClineStealthModels(models)
			}
		} catch (error) {
			console.error("Error reading cached Vercel AI Gateway models:", error)
		}
	}

	return cache.models
}

async function migrateModelProviderCache(): Promise<string> {
	const cacheDir = await ensureCacheDirectoryExists()

	const clinePath = path.join(cacheDir, GlobalFileNames.clineModelsCache)
	const openRouter = path.join(cacheDir, GlobalFileNames.openRouterModels)

	try {
		if (!(await fileExistsAtPath(clinePath)) && (await fileExistsAtPath(openRouter))) {
			// Rename OpenRouter cache to Cline cache
			await fs.rename(openRouter, clinePath)
		}
	} catch (error) {
		console.error("Error migrating model provider cache:", error)
	}
	return clinePath
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

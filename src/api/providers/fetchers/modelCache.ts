import * as path from "path"
import fs from "fs/promises"

import NodeCache from "node-cache"
import { safeWriteJson } from "../../../utils/safeWriteJson"

import { ContextProxy } from "../../../core/config/ContextProxy"
import { getCacheDirectoryPath } from "../../../utils/storage"
import { RouterName, ModelRecord } from "../../../shared/api"
import { fileExistsAtPath } from "../../../utils/fs"

import { getOpenRouterModels } from "./openrouter"
import { getRequestyModels } from "./requesty"
import { getGlamaModels } from "./glama"
import { getUnboundModels } from "./unbound"
import { getLiteLLMModels } from "./litellm"
import { GetModelsOptions } from "../../../shared/api"
import { getOllamaModels } from "./ollama"
import { getLMStudioModels } from "./lmstudio"

const memoryCache = new NodeCache({ stdTTL: 5 * 60, checkperiod: 5 * 60 })

async function writeModels(router: RouterName, data: ModelRecord) {
	const filename = `${router}_models.json`
	const cacheDir = await getCacheDirectoryPath(ContextProxy.instance.globalStorageUri.fsPath)
	await safeWriteJson(path.join(cacheDir, filename), data)
}

async function readModels(router: RouterName): Promise<ModelRecord | undefined> {
	const filename = `${router}_models.json`
	const cacheDir = await getCacheDirectoryPath(ContextProxy.instance.globalStorageUri.fsPath)
	const filePath = path.join(cacheDir, filename)
	const exists = await fileExistsAtPath(filePath)
	return exists ? JSON.parse(await fs.readFile(filePath, "utf8")) : undefined
}

/**
 * Get models from the cache or fetch them from the provider and cache them.
 * There are two caches:
 * 1. Memory cache - This is a simple in-memory cache that is used to store models for a short period of time.
 * 2. File cache - This is a file-based cache that is used to store models for a longer period of time.
 *
 * @param router - The router to fetch models from.
 * @param apiKey - Optional API key for the provider.
 * @param baseUrl - Optional base URL for the provider (currently used only for LiteLLM).
 * @returns The models from the cache or the fetched models.
 */
export const getModels = async (options: GetModelsOptions): Promise<ModelRecord> => {
	const { provider } = options
	let models = memoryCache.get<ModelRecord>(provider)
	if (models) {
		return models
	}

	try {
		switch (provider) {
			case "openrouter":
				models = await getOpenRouterModels()
				break
			case "requesty":
				// Requesty models endpoint requires an API key for per-user custom policies
				models = await getRequestyModels(options.apiKey)
				break
			case "glama":
				models = await getGlamaModels()
				break
			case "unbound":
				// Unbound models endpoint requires an API key to fetch application specific models
				models = await getUnboundModels(options.apiKey)
				break
			case "litellm":
				// Type safety ensures apiKey and baseUrl are always provided for litellm
				models = await getLiteLLMModels(options.apiKey, options.baseUrl)
				break
			case "ollama":
				models = await getOllamaModels(options.baseUrl)
				break
			case "lmstudio":
				models = await getLMStudioModels(options.baseUrl)
				break
			default: {
				// Ensures router is exhaustively checked if RouterName is a strict union
				const exhaustiveCheck: never = provider
				throw new Error(`Unknown provider: ${exhaustiveCheck}`)
			}
		}

		// Cache the fetched models (even if empty, to signify a successful fetch with no models)
		memoryCache.set(provider, models)
		await writeModels(provider, models).catch((err) =>
			console.error(`[getModels] Error writing ${provider} models to file cache:`, err),
		)

		try {
			models = await readModels(provider)
			// console.log(`[getModels] read ${router} models from file cache`)
		} catch (error) {
			console.error(`[getModels] error reading ${provider} models from file cache`, error)
		}
		return models || {}
	} catch (error) {
		// Log the error and re-throw it so the caller can handle it (e.g., show a UI message).
		console.error(`[getModels] Failed to fetch models in modelCache for ${provider}:`, error)

		throw error // Re-throw the original error to be handled by the caller.
	}
}

/**
 * Flush models memory cache for a specific router
 * @param router - The router to flush models for.
 */
export const flushModels = async (router: RouterName) => {
	memoryCache.del(router)
}

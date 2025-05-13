import * as path from "path"
import fs from "fs/promises"

import NodeCache from "node-cache"

import { ContextProxy } from "../../../core/config/ContextProxy"
import { getCacheDirectoryPath } from "../../../shared/storagePathManager"
import { RouterName, ModelRecord } from "../../../shared/api"
import { fileExistsAtPath } from "../../../utils/fs"

import { getOpenRouterModels } from "./openrouter"
import { getRequestyModels } from "./requesty"
import { getGlamaModels } from "./glama"
import { getUnboundModels } from "./unbound"
import { getLiteLLMModels } from "./litellm"

const memoryCache = new NodeCache({ stdTTL: 5 * 60, checkperiod: 5 * 60 })

async function writeModels(router: RouterName, data: ModelRecord) {
	const filename = `${router}_models.json`
	const cacheDir = await getCacheDirectoryPath(ContextProxy.instance.globalStorageUri.fsPath)
	await fs.writeFile(path.join(cacheDir, filename), JSON.stringify(data))
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
export const getModels = async (
	router: RouterName,
	apiKey: string | undefined = undefined,
	baseUrl: string | undefined = undefined,
): Promise<ModelRecord> => {
	let models = memoryCache.get<ModelRecord>(router)

	if (models) {
		// console.log(`[getModels] NodeCache hit for ${router} -> ${Object.keys(models).length}`)
		return models
	}

	switch (router) {
		case "openrouter":
			models = await getOpenRouterModels()
			break
		case "requesty":
			// Requesty models endpoint requires an API key for per-user custom policies
			models = await getRequestyModels(apiKey)
			break
		case "glama":
			models = await getGlamaModels()
			break
		case "unbound":
			models = await getUnboundModels()
			break
		case "litellm":
			if (apiKey && baseUrl) {
				models = await getLiteLLMModels(apiKey, baseUrl)
			} else {
				models = {}
			}
			break
	}

	if (Object.keys(models).length > 0) {
		// console.log(`[getModels] API fetch for ${router} -> ${Object.keys(models).length}`)
		memoryCache.set(router, models)

		try {
			await writeModels(router, models)
			// console.log(`[getModels] wrote ${router} models to file cache`)
		} catch (error) {
			console.error(`[getModels] error writing ${router} models to file cache`, error)
		}

		return models
	}

	try {
		models = await readModels(router)
		// console.log(`[getModels] read ${router} models from file cache`)
	} catch (error) {
		console.error(`[getModels] error reading ${router} models from file cache`, error)
	}

	return models ?? {}
}

/**
 * Flush models memory cache for a specific router
 * @param router - The router to flush models for.
 */
export const flushModels = async (router: RouterName) => {
	memoryCache.del(router)
}

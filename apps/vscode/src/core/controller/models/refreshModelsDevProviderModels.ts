import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { applyModelsDevProviderModels, type ModelsDevProviderModels, normalizeModelsDevProviderModels } from "@shared/models-dev"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { StateManager } from "@/core/storage/StateManager"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"

export const MODELS_DEV_CATALOG_URL = "https://models.dev/api.json"

let pendingRefresh: Promise<ModelsDevProviderModels> | null = null

export async function refreshModelsDevProviderModels(): Promise<ModelsDevProviderModels> {
	const cache = StateManager.get().getModelsDevProviderModelsCache()
	if (cache) {
		applyModelsDevProviderModels(cache)
		return cache
	}

	if (pendingRefresh) {
		return pendingRefresh
	}

	pendingRefresh = (async () => {
		try {
			return await fetchAndCacheModelsDevProviderModels()
		} finally {
			pendingRefresh = null
		}
	})()

	return pendingRefresh
}

async function fetchAndCacheModelsDevProviderModels(): Promise<ModelsDevProviderModels> {
	const modelsDevProviderModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.modelsDevProviderModels)

	let providerModels: ModelsDevProviderModels = {}
	try {
		const response = await axios.get(MODELS_DEV_CATALOG_URL, getAxiosSettings())
		providerModels = normalizeModelsDevProviderModels(response.data)

		if (Object.keys(providerModels).length === 0) {
			throw new Error("No supported models.dev provider models found")
		}

		await fs.writeFile(modelsDevProviderModelsFilePath, JSON.stringify(providerModels))
		Logger.log("models.dev provider models fetched and saved")
	} catch (error) {
		Logger.error("Error fetching models.dev provider models:", error)

		const cachedModels = await readModelsDevProviderModelsFromCache()
		if (cachedModels && Object.keys(cachedModels).length > 0) {
			providerModels = cachedModels
			Logger.log("Loaded models.dev provider models from cache")
		}
	}

	if (Object.keys(providerModels).length > 0) {
		applyModelsDevProviderModels(providerModels)
		StateManager.get().setModelsDevProviderModelsCache(providerModels)
	}

	return providerModels
}

export async function readModelsDevProviderModelsFromCache(): Promise<ModelsDevProviderModels | undefined> {
	try {
		const modelsDevProviderModelsFilePath = path.join(
			await ensureCacheDirectoryExists(),
			GlobalFileNames.modelsDevProviderModels,
		)
		const fileExists = await fileExistsAtPath(modelsDevProviderModelsFilePath)
		if (fileExists) {
			const fileContents = await fs.readFile(modelsDevProviderModelsFilePath, "utf8")
			return JSON.parse(fileContents)
		}
	} catch (error) {
		Logger.error("Error reading cached models.dev provider models:", error)
	}
	return undefined
}

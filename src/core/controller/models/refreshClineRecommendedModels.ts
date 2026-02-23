import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { ClineEnv } from "@/config"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

export interface ClineRecommendedModelData {
	id: string
	name: string
	description: string
	tags: string[]
}

export interface ClineRecommendedModelsData {
	recommended: ClineRecommendedModelData[]
	free: ClineRecommendedModelData[]
}

const RECOMMENDED_MODELS_CACHE_TTL_MS = 60 * 60 * 1000

let pendingRefresh: Promise<ClineRecommendedModelsData> | null = null
let inMemoryCache: { data: ClineRecommendedModelsData; timestamp: number } | null = null

function normalizeRecommendedModel(raw: unknown): ClineRecommendedModelData | null {
	if (!raw || typeof raw !== "object") {
		return null
	}

	const data = raw as Record<string, unknown>
	if (typeof data.id !== "string" || data.id.length === 0) {
		return null
	}

	return {
		id: data.id,
		name: typeof data.name === "string" && data.name.length > 0 ? data.name : data.id,
		description: typeof data.description === "string" ? data.description : "",
		tags: Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === "string") : [],
	}
}

function normalizeRecommendedModelsResponse(raw: unknown): ClineRecommendedModelsData | null {
	if (!raw || typeof raw !== "object") {
		return null
	}

	const data = raw as Record<string, unknown>
	if (
		(data.recommended !== undefined && !Array.isArray(data.recommended)) ||
		(data.free !== undefined && !Array.isArray(data.free))
	) {
		return null
	}

	const recommendedRaw = Array.isArray(data.recommended) ? data.recommended : []
	const freeRaw = Array.isArray(data.free) ? data.free : []

	const recommended = recommendedRaw
		.map((model) => normalizeRecommendedModel(model))
		.filter((model): model is ClineRecommendedModelData => model !== null)

	const free = freeRaw
		.map((model) => normalizeRecommendedModel(model))
		.filter((model): model is ClineRecommendedModelData => model !== null)

	return { recommended, free }
}

export async function refreshClineRecommendedModels(_controller: Controller): Promise<ClineRecommendedModelsData> {
	if (inMemoryCache && Date.now() - inMemoryCache.timestamp <= RECOMMENDED_MODELS_CACHE_TTL_MS) {
		return inMemoryCache.data
	}

	if (pendingRefresh) {
		return pendingRefresh
	}

	pendingRefresh = (async () => {
		try {
			return await fetchAndCacheClineRecommendedModels()
		} finally {
			pendingRefresh = null
		}
	})()

	return pendingRefresh
}

async function fetchAndCacheClineRecommendedModels(): Promise<ClineRecommendedModelsData> {
	const clineRecommendedModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.clineRecommendedModels)
	let result: ClineRecommendedModelsData = { recommended: [], free: [] }

	try {
		const apiBaseUrl = ClineEnv.config().apiBaseUrl
		const response = await axios.get(`${apiBaseUrl}/api/v1/ai/cline/recommended-models`, getAxiosSettings())
		const normalized = normalizeRecommendedModelsResponse(response.data)
		if (!normalized) {
			throw new Error("Invalid response data when fetching Cline recommended models")
		}

		result = normalized
		await fs.writeFile(clineRecommendedModelsFilePath, JSON.stringify(result))
		Logger.log("Cline recommended models fetched and saved")
	} catch (error) {
		Logger.error("Error fetching Cline recommended models:", error)

		try {
			const fileExists = await fs
				.access(clineRecommendedModelsFilePath)
				.then(() => true)
				.catch(() => false)
			if (fileExists) {
				const fileContents = await fs.readFile(clineRecommendedModelsFilePath, "utf8")
				const parsed = JSON.parse(fileContents)
				if (parsed) {
					result = parsed
					Logger.log("Loaded Cline recommended models from cache")
				}
			}
		} catch (cacheError) {
			Logger.error("Error reading Cline recommended models from cache:", cacheError)
		}
	}

	// Avoid pinning empty results in memory for the full TTL after a transient API/cache miss.
	if (result.recommended.length > 0 || result.free.length > 0) {
		inMemoryCache = { data: result, timestamp: Date.now() }
	}
	return result
}

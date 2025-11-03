import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { ModelInfo } from "@shared/api"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { Controller } from ".."

class HeliconeModelsResponse {
	models: HeliconeModel[]
	total?: number
	filters?: HeliconeFilters

	private constructor(models: HeliconeModel[], total?: number, filters?: HeliconeFilters) {
		this.models = models
		this.total = total
		this.filters = filters
	}

	static fromJSON(obj: any): HeliconeModelsResponse {
		// API returns shape: { data: { models: [...] }, error: null }
		// Fall back to top-level for safety
		const container = obj?.data ?? obj
		const modelsArray = Array.isArray(container?.models) ? container.models : []
		// @ts-ignore
		const models = modelsArray.map((m) => HeliconeModel.fromJSON(m))
		const total = typeof container?.total === "number" ? container.total : undefined
		const filters = HeliconeFilters.fromJSON(container?.filters)
		return new HeliconeModelsResponse(models, total, filters)
	}
}

class HeliconeModel {
	// @ts-ignore
	id: string
	name?: string
	author?: string
	contextLength?: number
	endpoints?: HeliconeEndpoint[]
	maxOutput?: number
	trainingDate?: string
	description?: string
	inputModalities?: (string | null)[]
	outputModalities?: (string | null)[]
	supportedParameters?: (string | null)[]

	private constructor(init: HeliconeModel) {
		Object.assign(this, init)
	}

	static fromJSON(obj: any): HeliconeModel {
		const endpoints = Array.isArray(obj?.endpoints) ? obj.endpoints.map((e: any) => HeliconeEndpoint.fromJSON(e)) : undefined
		return new HeliconeModel({
			id: String(obj?.id ?? ""),
			name: typeof obj?.name === "string" ? obj.name : undefined,
			author: typeof obj?.author === "string" ? obj.author : undefined,
			contextLength: typeof obj?.contextLength === "number" ? obj.contextLength : undefined,
			endpoints,
			maxOutput: typeof obj?.maxOutput === "number" ? obj.maxOutput : undefined,
			trainingDate: typeof obj?.trainingDate === "string" ? obj.trainingDate : undefined,
			description: typeof obj?.description === "string" ? obj.description : undefined,
			inputModalities: Array.isArray(obj?.inputModalities) ? obj.inputModalities : undefined,
			outputModalities: Array.isArray(obj?.outputModalities) ? obj.outputModalities : undefined,
			supportedParameters: Array.isArray(obj?.supportedParameters) ? obj.supportedParameters : undefined,
		})
	}
}

class HeliconeEndpoint {
	provider?: string
	providerSlug?: string
	supportsPtb?: boolean
	pricing?: HeliconePricing

	private constructor(init: HeliconeEndpoint) {
		Object.assign(this, init)
	}

	static fromJSON(obj: any): HeliconeEndpoint {
		return new HeliconeEndpoint({
			provider: typeof obj?.provider === "string" ? obj.provider : undefined,
			providerSlug: typeof obj?.providerSlug === "string" ? obj.providerSlug : undefined,
			supportsPtb: typeof obj?.supportsPtb === "boolean" ? obj.supportsPtb : undefined,
			pricing: HeliconePricing.fromJSON(obj?.pricing),
		})
	}
}

class HeliconePricing {
	prompt?: number
	completion?: number
	cacheRead?: number
	cacheWrite?: number

	private constructor(init: HeliconePricing) {
		Object.assign(this, init)
	}

	static fromJSON(obj: any): HeliconePricing | undefined {
		if (!obj || typeof obj !== "object") {
			return undefined
		}
		const prompt = typeof obj?.prompt === "number" ? obj.prompt : undefined
		const completion = typeof obj?.completion === "number" ? obj.completion : undefined
		const cacheRead = typeof obj?.cacheRead === "number" ? obj.cacheRead : undefined
		const cacheWrite = typeof obj?.cacheWrite === "number" ? obj.cacheWrite : undefined
		if (prompt === undefined && completion === undefined && cacheRead === undefined && cacheWrite === undefined) {
			return undefined
		}
		return new HeliconePricing({ prompt, completion, cacheRead, cacheWrite })
	}
}

class HeliconeFilters {
	providers?: { name: string; displayName: string }[]
	authors?: string[]
	capabilities?: string[]

	private constructor(init: HeliconeFilters) {
		Object.assign(this, init)
	}

	static fromJSON(obj: any): HeliconeFilters | undefined {
		if (!obj || typeof obj !== "object") {
			return undefined
		}
		const providers = Array.isArray(obj?.providers)
			? (obj.providers
					.map((p: any) =>
						typeof p?.name === "string" && typeof p?.displayName === "string"
							? { name: p.name, displayName: p.displayName }
							: undefined,
					)
					.filter(Boolean) as { name: string; displayName: string }[])
			: undefined
		const authors = Array.isArray(obj?.authors) ? obj.authors.filter((a: any) => typeof a === "string") : undefined
		const capabilities = Array.isArray(obj?.capabilities)
			? obj.capabilities.filter((c: any) => typeof c === "string")
			: undefined
		return new HeliconeFilters({ providers, authors, capabilities })
	}
}

/**
 * Refreshes Helicone models and returns application types
 */
export async function refreshHeliconeModels(_controller: Controller): Promise<Record<string, ModelInfo>> {
	const modelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.heliconeModels)
	const url = "https://api.helicone.ai/v1/public/model-registry/models"

	let models: Record<string, ModelInfo> = {}
	try {
		const response = await axios.get(url, { responseType: "json" })
		const data = HeliconeModelsResponse.fromJSON(response.data)
		if (data?.models && data.models.length >= 0) {
			const parsed: Record<string, ModelInfo> = {}
			for (const m of data.models) {
				if (!m?.id) {
					continue
				}
				const firstEndpoint = Array.isArray(m.endpoints) && m.endpoints.length > 0 ? m.endpoints[0] : undefined
				const pricing = firstEndpoint?.pricing
				const contextLength = typeof m.contextLength === "number" ? m.contextLength : 0
				const maxOutput = typeof m.maxOutput === "number" ? m.maxOutput : 0

				const modalities = [
					...(Array.isArray(m.inputModalities) ? m.inputModalities : []),
					...(Array.isArray(m.outputModalities) ? m.outputModalities : []),
				]
				const supportsImages = modalities.some((mod) => {
					if (typeof mod !== "string") {
						return false
					}
					const normalized = mod.toLowerCase()
					return normalized.includes("image") || normalized.includes("vision") || normalized.includes("multimodal")
				})

				parsed[m.id] = {
					maxTokens: maxOutput,
					contextWindow: contextLength,
					supportsImages,
					supportsPromptCache: typeof pricing?.cacheRead === "number" && typeof pricing?.cacheWrite === "number",
					inputPrice: typeof pricing?.prompt === "number" ? pricing!.prompt : undefined,
					outputPrice: typeof pricing?.completion === "number" ? pricing!.completion : undefined,
					cacheReadsPrice: typeof pricing?.cacheRead === "number" ? pricing!.cacheRead : undefined,
					cacheWritesPrice: typeof pricing?.cacheWrite === "number" ? pricing!.cacheWrite : undefined,
					description: typeof m.description === "string" ? m.description : undefined,
				}
			}
			models = parsed
			await fs.writeFile(modelsFilePath, JSON.stringify(models))
		} else {
			console.error("Invalid response from Helicone model registry API")
		}
	} catch (error) {
		console.error("Error fetching Helicone models:", error)
		const cached = await readHeliconeModels()
		if (cached) {
			models = cached
		}
	}
	return models
}

async function readHeliconeModels(): Promise<Record<string, ModelInfo> | undefined> {
	const modelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.heliconeModels)
	const exists = await fileExistsAtPath(modelsFilePath)
	if (exists) {
		try {
			const fileContents = await fs.readFile(modelsFilePath, "utf8")
			const parsed = JSON.parse(fileContents)
			try {
				/* noop */
			} catch {}
			return parsed
		} catch (error) {
			console.error("Error reading cached Helicone models:", error)
			return undefined
		}
	}
	return undefined
}

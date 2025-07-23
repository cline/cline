export interface HuggingFaceModel {
	_id: string
	id: string
	inferenceProviderMapping: InferenceProviderMapping[]
	trendingScore: number
	config: ModelConfig
	tags: string[]
	pipeline_tag: "text-generation" | "image-text-to-text"
	library_name?: string
}

export interface InferenceProviderMapping {
	provider: string
	providerId: string
	status: "live" | "staging" | "error"
	task: "conversational"
}

export interface ModelConfig {
	architectures: string[]
	model_type: string
	tokenizer_config?: {
		chat_template?: string | Array<{ name: string; template: string }>
		model_max_length?: number
	}
}

interface HuggingFaceApiParams {
	pipeline_tag?: "text-generation" | "image-text-to-text"
	filter: string
	inference_provider: string
	limit: number
	expand: string[]
}

const DEFAULT_PARAMS: HuggingFaceApiParams = {
	filter: "conversational",
	inference_provider: "all",
	limit: 100,
	expand: [
		"inferenceProviderMapping",
		"config",
		"library_name",
		"pipeline_tag",
		"tags",
		"mask_token",
		"trendingScore",
	],
}

const BASE_URL = "https://huggingface.co/api/models"
const CACHE_DURATION = 1000 * 60 * 60 // 1 hour

interface CacheEntry {
	data: HuggingFaceModel[]
	timestamp: number
	status: "success" | "partial" | "error"
}

let cache: CacheEntry | null = null

function buildApiUrl(params: HuggingFaceApiParams): string {
	const url = new URL(BASE_URL)

	// Add simple params
	Object.entries(params).forEach(([key, value]) => {
		if (!Array.isArray(value)) {
			url.searchParams.append(key, String(value))
		}
	})

	// Handle array params specially
	params.expand.forEach((item) => {
		url.searchParams.append("expand[]", item)
	})

	return url.toString()
}

const headers: HeadersInit = {
	"Upgrade-Insecure-Requests": "1",
	"Sec-Fetch-Dest": "document",
	"Sec-Fetch-Mode": "navigate",
	"Sec-Fetch-Site": "none",
	"Sec-Fetch-User": "?1",
	Priority: "u=0, i",
	Pragma: "no-cache",
	"Cache-Control": "no-cache",
}

const requestInit: RequestInit = {
	credentials: "include",
	headers,
	method: "GET",
	mode: "cors",
}

export async function fetchHuggingFaceModels(): Promise<HuggingFaceModel[]> {
	const now = Date.now()

	// Check cache
	if (cache && now - cache.timestamp < CACHE_DURATION) {
		console.log("Using cached Hugging Face models")
		return cache.data
	}

	try {
		console.log("Fetching Hugging Face models from API...")

		// Fetch both text-generation and image-text-to-text models in parallel
		const [textGenResponse, imgTextResponse] = await Promise.allSettled([
			fetch(buildApiUrl({ ...DEFAULT_PARAMS, pipeline_tag: "text-generation" }), requestInit),
			fetch(buildApiUrl({ ...DEFAULT_PARAMS, pipeline_tag: "image-text-to-text" }), requestInit),
		])

		let textGenModels: HuggingFaceModel[] = []
		let imgTextModels: HuggingFaceModel[] = []
		let hasErrors = false

		// Process text-generation models
		if (textGenResponse.status === "fulfilled" && textGenResponse.value.ok) {
			textGenModels = await textGenResponse.value.json()
		} else {
			console.error("Failed to fetch text-generation models:", textGenResponse)
			hasErrors = true
		}

		// Process image-text-to-text models
		if (imgTextResponse.status === "fulfilled" && imgTextResponse.value.ok) {
			imgTextModels = await imgTextResponse.value.json()
		} else {
			console.error("Failed to fetch image-text-to-text models:", imgTextResponse)
			hasErrors = true
		}

		// Combine and filter models
		const allModels = [...textGenModels, ...imgTextModels]
			.filter((model) => model.inferenceProviderMapping.length > 0)
			.sort((a, b) => a.id.toLowerCase().localeCompare(b.id.toLowerCase()))

		// Update cache
		cache = {
			data: allModels,
			timestamp: now,
			status: hasErrors ? "partial" : "success",
		}

		console.log(`Fetched ${allModels.length} Hugging Face models (status: ${cache.status})`)
		return allModels
	} catch (error) {
		console.error("Error fetching Hugging Face models:", error)

		// Return cached data if available
		if (cache) {
			console.log("Using stale cached data due to fetch error")
			cache.status = "error"
			return cache.data
		}

		// No cache available, return empty array
		return []
	}
}

export function getCachedModels(): HuggingFaceModel[] | null {
	return cache?.data || null
}

export function clearCache(): void {
	cache = null
}

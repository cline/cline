import {
	type ApiProvider,
	anthropicModels,
	bedrockModels,
	cerebrasModels,
	deepSeekModels,
	fireworksModels,
	geminiModels,
	huggingFaceModels,
	internationalZAiModels,
	type ModelInfo,
	mainlandZAiModels,
	minimaxModels,
	mistralModels,
	moonshotModels,
	nebiusModels,
	nousResearchModels,
	openAiNativeModels,
	sambanovaModels,
	vertexModels,
	wandbModels,
	xaiModels,
} from "./api"

export type ModelsDevModelInfo = ModelInfo & {
	releaseDate?: string
	family?: string
	supportsReasoningEffort?: boolean
	supportsTools?: boolean
}

export type ModelsDevProviderModels = Partial<Record<ApiProvider, Record<string, ModelsDevModelInfo>>>

export interface ModelsDevModel {
	name?: string
	tool_call?: boolean
	reasoning?: boolean
	structured_output?: boolean
	temperature?: boolean
	reasoning_options?: {
		type?: string
		values?: string[]
		min?: number
	}[]
	release_date?: string
	family?: string
	limit?: {
		context?: number
		input?: number
		output?: number
	}
	cost?: {
		input?: number
		output?: number
		cache_read?: number
		cache_write?: number
	}
	modalities?: {
		input?: string[]
	}
	status?: string
}

export type ModelsDevPayload = Record<string, { models?: Record<string, ModelsDevModel> }>

const DEFAULT_MAX_TOKENS = 4096

const MODELS_DEV_PROVIDER_KEY_MAP: Record<string, ApiProvider> = {
	"amazon-bedrock": "bedrock",
	anthropic: "anthropic",
	cerebras: "cerebras",
	deepseek: "deepseek",
	"fireworks-ai": "fireworks",
	google: "gemini",
	"google-vertex": "vertex",
	huggingface: "huggingface",
	minimax: "minimax",
	mistral: "mistral",
	moonshotai: "moonshot",
	nebius: "nebius",
	"nous-research": "nousResearch",
	openai: "openai-native",
	sambanova: "sambanova",
	wandb: "wandb",
	xai: "xai",
	zai: "zai",
}

const STATIC_MODELS_BY_PROVIDER: Partial<Record<ApiProvider, Record<string, ModelInfo>>> = {
	anthropic: anthropicModels as Record<string, ModelInfo>,
	bedrock: bedrockModels as Record<string, ModelInfo>,
	cerebras: cerebrasModels as Record<string, ModelInfo>,
	deepseek: deepSeekModels as Record<string, ModelInfo>,
	fireworks: fireworksModels as Record<string, ModelInfo>,
	gemini: geminiModels as Record<string, ModelInfo>,
	huggingface: huggingFaceModels as Record<string, ModelInfo>,
	minimax: minimaxModels as Record<string, ModelInfo>,
	mistral: mistralModels as Record<string, ModelInfo>,
	moonshot: moonshotModels as Record<string, ModelInfo>,
	nebius: nebiusModels as Record<string, ModelInfo>,
	nousResearch: nousResearchModels as Record<string, ModelInfo>,
	"openai-native": openAiNativeModels as Record<string, ModelInfo>,
	sambanova: sambanovaModels as Record<string, ModelInfo>,
	vertex: vertexModels as Record<string, ModelInfo>,
	wandb: wandbModels as Record<string, ModelInfo>,
	xai: xaiModels as Record<string, ModelInfo>,
	zai: internationalZAiModels as Record<string, ModelInfo>,
}

function parseReleaseDate(value: string | undefined): number {
	if (!value) {
		return Number.NEGATIVE_INFINITY
	}
	const timestamp = Date.parse(value)
	return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp
}

function sortModelsByReleaseDate(models: Record<string, ModelsDevModelInfo>): Record<string, ModelsDevModelInfo> {
	return Object.fromEntries(
		Object.entries(models).sort(([modelIdA, modelA], [modelIdB, modelB]) => {
			const releaseDateA = parseReleaseDate(modelA.releaseDate)
			const releaseDateB = parseReleaseDate(modelB.releaseDate)
			if (releaseDateA !== releaseDateB) {
				return releaseDateB - releaseDateA
			}
			return modelIdA.localeCompare(modelIdB)
		}),
	)
}

function hasCachePricing(cost: ModelsDevModel["cost"]): boolean {
	return typeof cost?.cache_read === "number" || typeof cost?.cache_write === "number"
}

function supportsReasoningEffort(model: ModelsDevModel): boolean {
	return model.reasoning_options?.some((option) => option.type === "effort") ?? false
}

function toModelInfo(modelId: string, model: ModelsDevModel): ModelsDevModelInfo {
	const supportsPromptCache = hasCachePricing(model.cost)
	const supportsReasoning = model.reasoning === true
	const supportsEffort = supportsReasoningEffort(model)
	const info: ModelsDevModelInfo = {
		name: model.name || modelId,
		maxTokens: Math.floor(model.limit?.output ?? DEFAULT_MAX_TOKENS),
		contextWindow: model.limit?.context,
		supportsImages: model.modalities?.input?.includes("image") ?? false,
		supportsPromptCache,
		supportsReasoning,
		inputPrice: model.cost?.input ?? 0,
		outputPrice: model.cost?.output ?? 0,
		cacheReadsPrice: model.cost?.cache_read,
		cacheWritesPrice: model.cost?.cache_write,
		description: "",
		thinkingConfig: supportsReasoning ? { maxBudget: model.limit?.output ?? DEFAULT_MAX_TOKENS } : undefined,
		releaseDate: model.release_date,
		family: model.family,
		supportsReasoningEffort: supportsEffort,
		supportsTools: model.tool_call === true,
	}

	return info
}

function isSupportedModelsDevModel(model: ModelsDevModel): boolean {
	return model.tool_call === true && model.status !== "deprecated"
}

export function normalizeModelsDevProviderModels(payload: ModelsDevPayload): ModelsDevProviderModels {
	const providerModels: ModelsDevProviderModels = {}

	for (const [modelsDevProviderKey, providerId] of Object.entries(MODELS_DEV_PROVIDER_KEY_MAP)) {
		const sourceModels = payload[modelsDevProviderKey]?.models
		if (!sourceModels) {
			continue
		}

		const models: Record<string, ModelsDevModelInfo> = {}
		for (const [modelId, model] of Object.entries(sourceModels)) {
			if (!isSupportedModelsDevModel(model)) {
				continue
			}
			models[modelId] = toModelInfo(modelId, model)
		}

		if (Object.keys(models).length > 0) {
			providerModels[providerId] = sortModelsByReleaseDate(models)
		}
	}

	return providerModels
}

export function getStaticModelsForModelsDevProvider(providerId: ApiProvider): Record<string, ModelInfo> | undefined {
	return STATIC_MODELS_BY_PROVIDER[providerId]
}

export function mergeModelsDevModels(
	staticModels: Record<string, ModelInfo>,
	modelsDevModels: Record<string, ModelInfo> | undefined,
): Record<string, ModelInfo> {
	if (!modelsDevModels || Object.keys(modelsDevModels).length === 0) {
		return staticModels
	}

	const additions = Object.fromEntries(Object.entries(modelsDevModels).filter(([modelId]) => !(modelId in staticModels)))
	return {
		...staticModels,
		...additions,
	}
}

export function applyModelsDevProviderModels(providerModels: ModelsDevProviderModels | undefined): void {
	if (!providerModels) {
		return
	}

	for (const [providerId, models] of Object.entries(providerModels) as [ApiProvider, Record<string, ModelInfo>][]) {
		const staticModels = getStaticModelsForModelsDevProvider(providerId)
		if (!staticModels) {
			continue
		}

		for (const [modelId, modelInfo] of Object.entries(models)) {
			if (!(modelId in staticModels)) {
				staticModels[modelId] = modelInfo
			}
			if (providerId === "zai") {
				const mainlandModels = mainlandZAiModels as Record<string, ModelInfo>
				if (!(modelId in mainlandModels)) {
					mainlandModels[modelId] = modelInfo
				}
			}
		}
	}
}

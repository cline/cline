import type { ApiProvider, ModelInfo, OpenAiCompatibleModelInfo } from "../api";
import {
	modelsDevProviderModels as generatedModelsDevProviderModels,
	modelsDevProviderOptions,
} from "./models-dev-catalog.generated";

export { modelsDevProviderOptions };

export type ModelsDevProviderModels = Record<
	string,
	Record<string, ModelInfo | OpenAiCompatibleModelInfo>
>;

type ModelsDevModel = {
	name?: string;
	tool_call?: boolean;
	reasoning?: boolean;
	structured_output?: boolean;
	temperature?: boolean;
	release_date?: string;
	family?: string;
	limit?: {
		context?: number;
		input?: number;
		output?: number;
	};
	cost?: {
		input?: number;
		output?: number;
		cache_read?: number;
		cache_write?: number;
	};
	modalities?: {
		input?: string[];
	};
	status?: string;
};

type ModelsDevPayload = Record<
	string,
	{ models?: Record<string, ModelsDevModel> }
>;

const MODELS_DEV_PROVIDER_KEY_MAP: ReadonlyArray<{
	source: string;
	target: ApiProvider;
}> = [
	{ source: "openai", target: "openai-native" },
	{ source: "openai", target: "openai-codex" },
	{ source: "anthropic", target: "anthropic" },
	{ source: "google", target: "gemini" },
	{ source: "deepseek", target: "deepseek" },
	{ source: "xai", target: "xai" },
	{ source: "togetherai", target: "together" },
	{ source: "sap-ai-core", target: "sapaicore" },
	{ source: "ollama-cloud", target: "ollama" },
	{ source: "fireworks-ai", target: "fireworks" },
	{ source: "groq", target: "groq" },
	{ source: "cerebras", target: "cerebras" },
	{ source: "sambanova", target: "sambanova" },
	{ source: "nebius", target: "nebius" },
	{ source: "huggingface", target: "huggingface" },
	{ source: "openrouter", target: "openrouter" },
	{ source: "openrouter", target: "cline" },
	{ source: "vercel", target: "vercel-ai-gateway" },
	{ source: "aihubmix", target: "aihubmix" },
	{ source: "baseten", target: "baseten" },
	{ source: "google-vertex", target: "vertex" },
	{ source: "lmstudio", target: "lmstudio" },
	{ source: "zai", target: "zai" },
	{ source: "requesty", target: "requesty" },
	{ source: "amazon-bedrock", target: "bedrock" },
	{ source: "moonshotai", target: "moonshot" },
	{ source: "minimax", target: "minimax" },
	{ source: "wandb", target: "wandb" },
];

const DEFAULT_MAX_INPUT_TOKENS = 4096;
const DEFAULT_MAX_TOKENS = 4096;

let liveModelsDevProviderModels: ModelsDevProviderModels | undefined;

export function setLiveModelsDevProviderModels(
	models: ModelsDevProviderModels | undefined,
): void {
	liveModelsDevProviderModels =
		models && Object.keys(models).length > 0 ? models : undefined;
	refreshNamedModelExports();
}

export function getModelsDevProviderModels(
	provider: ApiProvider | string,
): Record<string, ModelInfo> {
	return (liveModelsDevProviderModels?.[provider] ??
		generatedModelsDevProviderModels[
			provider as keyof typeof generatedModelsDevProviderModels
		] ??
		{}) as Record<string, ModelInfo>;
}

export let modelsDevAnthropicModels = getModelsDevProviderModels("anthropic");
export let modelsDevBedrockModels = getModelsDevProviderModels("bedrock");
export let modelsDevCerebrasModels = getModelsDevProviderModels("cerebras");
export let modelsDevDeepSeekModels = getModelsDevProviderModels("deepseek");
export let modelsDevDoubaoModels = getModelsDevProviderModels("doubao");
export let modelsDevFireworksModels = getModelsDevProviderModels("fireworks");
export let modelsDevGeminiModels = getModelsDevProviderModels("gemini");
export let modelsDevGroqModels = getModelsDevProviderModels("groq");
export let modelsDevHuggingFaceModels =
	getModelsDevProviderModels("huggingface");
export let modelsDevMinimaxModels = getModelsDevProviderModels("minimax");
export let modelsDevMistralModels = getModelsDevProviderModels("mistral");
export let modelsDevMoonshotModels = getModelsDevProviderModels("moonshot");
export let modelsDevNebiusModels = getModelsDevProviderModels("nebius");
export let modelsDevNousResearchModels =
	getModelsDevProviderModels("nousResearch");
export let modelsDevOpenAiCodexModels =
	getModelsDevProviderModels("openai-codex");
export let modelsDevOpenAiNativeModels =
	getModelsDevProviderModels("openai-native");
export let modelsDevSambanovaModels = getModelsDevProviderModels("sambanova");
export let modelsDevSapAiCoreModels = getModelsDevProviderModels("sapaicore");
export let modelsDevVertexModels = getModelsDevProviderModels("vertex");
export let modelsDevWandbModels = getModelsDevProviderModels("wandb");
export let modelsDevXaiModels = getModelsDevProviderModels("xai");

function refreshNamedModelExports(): void {
	modelsDevAnthropicModels = getModelsDevProviderModels("anthropic");
	modelsDevBedrockModels = getModelsDevProviderModels("bedrock");
	modelsDevCerebrasModels = getModelsDevProviderModels("cerebras");
	modelsDevDeepSeekModels = getModelsDevProviderModels("deepseek");
	modelsDevDoubaoModels = getModelsDevProviderModels("doubao");
	modelsDevFireworksModels = getModelsDevProviderModels("fireworks");
	modelsDevGeminiModels = getModelsDevProviderModels("gemini");
	modelsDevGroqModels = getModelsDevProviderModels("groq");
	modelsDevHuggingFaceModels = getModelsDevProviderModels("huggingface");
	modelsDevMinimaxModels = getModelsDevProviderModels("minimax");
	modelsDevMistralModels = getModelsDevProviderModels("mistral");
	modelsDevMoonshotModels = getModelsDevProviderModels("moonshot");
	modelsDevNebiusModels = getModelsDevProviderModels("nebius");
	modelsDevNousResearchModels = getModelsDevProviderModels("nousResearch");
	modelsDevOpenAiCodexModels = getModelsDevProviderModels("openai-codex");
	modelsDevOpenAiNativeModels = getModelsDevProviderModels("openai-native");
	modelsDevSambanovaModels = getModelsDevProviderModels("sambanova");
	modelsDevSapAiCoreModels = getModelsDevProviderModels("sapaicore");
	modelsDevVertexModels = getModelsDevProviderModels("vertex");
	modelsDevWandbModels = getModelsDevProviderModels("wandb");
	modelsDevXaiModels = getModelsDevProviderModels("xai");
}

export async function fetchLiveModelsDevProviderModels(
	url = "https://models.dev/api.json",
	fetcher: typeof fetch = fetch,
): Promise<ModelsDevProviderModels> {
	const response = await fetcher(url);
	if (!response.ok) {
		throw new Error(
			`Failed to load model catalog from ${url}: HTTP ${response.status}`,
		);
	}

	return normalizeModelsDevProviderModels(
		(await response.json()) as ModelsDevPayload,
	);
}

export function normalizeModelsDevProviderModels(
	payload: ModelsDevPayload,
): ModelsDevProviderModels {
	const providerModels: ModelsDevProviderModels = {};

	for (const {
		source: sourceProviderKey,
		target: targetProviderId,
	} of MODELS_DEV_PROVIDER_KEY_MAP) {
		const source = payload[sourceProviderKey];
		if (!source?.models) {
			continue;
		}

		const models: Record<string, ModelInfo | OpenAiCompatibleModelInfo> = {};
		for (const [modelId, model] of Object.entries(source.models)) {
			if (model.tool_call !== true || model.status === "deprecated") {
				continue;
			}
			models[modelId] = toModelInfo(modelId, model);
		}

		if (Object.keys(models).length > 0) {
			providerModels[targetProviderId] = sortModelsByReleaseDate(models);
		}
	}

	return providerModels;
}

function toModelInfo(
	_modelId: string,
	model: ModelsDevModel,
): ModelInfo | OpenAiCompatibleModelInfo {
	const inputLimit = resolveMaxInputTokens(model.limit);
	const outputLimit = Math.floor(model.limit?.output ?? DEFAULT_MAX_TOKENS);
	const capabilities = toCapabilities(model);

	return {
		name: model.name,
		contextWindow: model.limit?.context ?? inputLimit,
		maxTokens: outputLimit,
		supportsImages: capabilities.has("images"),
		supportsPromptCache: capabilities.has("prompt-cache"),
		supportsReasoning: capabilities.has("reasoning"),
		inputPrice: model.cost?.input ?? 0,
		outputPrice: model.cost?.output ?? 0,
		cacheReadsPrice: model.cost?.cache_read ?? 0,
		cacheWritesPrice: model.cost?.cache_write ?? 0,
		supportsTools: capabilities.has("tools"),
	};
}

function resolveMaxInputTokens(
	limit: ModelsDevModel["limit"] | undefined,
): number {
	const contextLimit = limit?.context;
	const inputLimit = limit?.input;
	if (typeof contextLimit === "number" && typeof inputLimit === "number") {
		return Math.min(contextLimit, inputLimit);
	}
	return inputLimit ?? contextLimit ?? DEFAULT_MAX_INPUT_TOKENS;
}

function toCapabilities(model: ModelsDevModel): Set<string> {
	const capabilities = new Set<string>();
	if (model.modalities?.input?.includes("image")) {
		capabilities.add("images");
	}
	if (model.tool_call === true) {
		capabilities.add("tools");
	}
	if (model.reasoning === true) {
		capabilities.add("reasoning");
	}
	if (model.structured_output === true) {
		capabilities.add("structured_output");
	}
	if (model.temperature === true) {
		capabilities.add("temperature");
	}
	if (
		(model.cost?.cache_read !== undefined && model.cost.cache_read >= 0) ||
		(model.cost?.cache_write !== undefined && model.cost.cache_write >= 0)
	) {
		capabilities.add("prompt-cache");
	}
	return capabilities;
}

function sortModelsByReleaseDate<
	T extends ModelInfo | OpenAiCompatibleModelInfo,
>(models: Record<string, T>): Record<string, T> {
	return Object.fromEntries(
		Object.entries(models).sort(([modelIdA, modelA], [modelIdB, modelB]) => {
			const releaseDateA = parseReleaseDate(
				(modelA as { releaseDate?: string }).releaseDate,
			);
			const releaseDateB = parseReleaseDate(
				(modelB as { releaseDate?: string }).releaseDate,
			);
			if (releaseDateA !== releaseDateB) {
				return releaseDateB - releaseDateA;
			}
			return modelIdA.localeCompare(modelIdB);
		}),
	);
}

function parseReleaseDate(value: string | undefined): number {
	if (!value) {
		return Number.NEGATIVE_INFINITY;
	}
	const timestamp = Date.parse(value);
	return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

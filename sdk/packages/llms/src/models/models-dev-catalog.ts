import type { ModelInfo } from "./types";

export interface ModelsDevModel {
	name?: string;
	tool_call?: boolean;
	reasoning?: boolean;
	structured_output?: boolean;
	temperature?: boolean;
	release_date?: string;
	limit?: {
		context?: number;
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
}

interface ModelsDevProviderPayload {
	models?: Record<string, ModelsDevModel>;
}

export type ModelsDevPayload = Record<string, ModelsDevProviderPayload>;
export type ModelsDevProviderKeyMap = Record<string, string>;

const DEFAULT_CONTEXT_WINDOW = 4096;
const DEFAULT_MAX_TOKENS = 4096;

function parseReleaseDate(value: string | undefined): number {
	if (!value) {
		return Number.NEGATIVE_INFINITY;
	}

	const timestamp = Date.parse(value);
	return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

export function sortModelsByReleaseDate(
	models: Record<string, ModelInfo>,
): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(models).sort(([modelIdA, modelA], [modelIdB, modelB]) => {
			const releaseDateA = parseReleaseDate(modelA.releaseDate);
			const releaseDateB = parseReleaseDate(modelB.releaseDate);
			if (releaseDateA !== releaseDateB) {
				return releaseDateB - releaseDateA;
			}
			return modelIdA.localeCompare(modelIdB);
		}),
	);
}

function toCapabilities(model: ModelsDevModel): ModelInfo["capabilities"] {
	const capabilities: NonNullable<ModelInfo["capabilities"]> = [];
	if (model.modalities?.input?.includes("image")) {
		capabilities.push("images");
	}
	if (model.modalities?.input?.includes("pdf")) {
		capabilities.push("files");
	}
	if (model.tool_call === true) {
		capabilities.push("tools");
	}
	if (model.reasoning === true) {
		capabilities.push("reasoning");
	}
	if (model.structured_output === true) {
		capabilities.push("structured_output");
	}
	if (model.temperature === true) {
		capabilities.push("temperature");
	}
	if ((model.cost?.cache_read ?? 0) > 0) {
		capabilities.push("prompt-cache");
	}
	return capabilities;
}

function toStatus(status: string | undefined): ModelInfo["status"] {
	if (
		status === "active" ||
		status === "preview" ||
		status === "deprecated" ||
		status === "legacy"
	) {
		return status;
	}
	return undefined;
}

function toModelInfo(modelId: string, model: ModelsDevModel): ModelInfo {
	// If context or output limits are missing, default to DEFAULT_CONTEXT_WINDOW and DEFAULT_MAX_TOKENS respectively.
	// If context and max are the same value, assume max tokens should be 5% of that value to avoid overallocation.
	const contextWindow = model.limit?.context ?? DEFAULT_CONTEXT_WINDOW;
	const outputToken = model.limit?.output ?? DEFAULT_MAX_TOKENS;
	const discounted =
		contextWindow === outputToken ? outputToken * 0.05 : outputToken;

	return {
		id: modelId,
		name: model.name || modelId,
		contextWindow,
		maxTokens: Math.floor(discounted),
		capabilities: toCapabilities(model),
		pricing: {
			input: model.cost?.input ?? 0,
			output: model.cost?.output ?? 0,
			cacheRead: model.cost?.cache_read ?? 0,
			cacheWrite: model.cost?.cache_write ?? 0,
		},
		status: toStatus(model.status),
		releaseDate: model.release_date,
	};
}

function isDeprecatedModel(model: ModelsDevModel): boolean {
	return model.status === "deprecated";
}

export function normalizeModelsDevProviderModels(
	payload: ModelsDevPayload,
	providerKeyMap: ModelsDevProviderKeyMap,
): Record<string, Record<string, ModelInfo>> {
	const providerModels: Record<string, Record<string, ModelInfo>> = {};

	for (const [sourceProviderKey, targetProviderId] of Object.entries(
		providerKeyMap,
	)) {
		const source = payload[sourceProviderKey];
		if (!source?.models) {
			continue;
		}

		const models: Record<string, ModelInfo> = {};
		for (const [modelId, model] of Object.entries(source.models)) {
			if (model.tool_call !== true || isDeprecatedModel(model)) {
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

export async function fetchModelsDevProviderModels(
	url: string,
	providerKeyMap: ModelsDevProviderKeyMap,
	fetcher: typeof fetch = fetch,
): Promise<Record<string, Record<string, ModelInfo>>> {
	const response = await fetcher(url);
	if (!response.ok) {
		throw new Error(
			`Failed to load model catalog from ${url}: HTTP ${response.status}`,
		);
	}

	const payload = (await response.json()) as ModelsDevPayload;
	return normalizeModelsDevProviderModels(payload, providerKeyMap);
}

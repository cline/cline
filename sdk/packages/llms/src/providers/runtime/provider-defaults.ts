/**
 * Provider Configurations
 *
 * Pre-configured settings for all supported OpenAI-compatible providers.
 * Model data is sourced from @clinebot/models (the single registry).
 */
/** biome-ignore-all lint/style/noNonNullAssertion: static */

import {
	MODELS_DEV_PROVIDER_KEY_MAP,
	resolveProviderModelCatalogKeys,
} from "@clinebot/shared";
import {
	fetchModelsDevProviderModels,
	sortModelsByReleaseDate,
} from "../../models/models-dev-catalog";
import type {
	ModelCatalogConfig,
	ModelInfo,
	ProviderCapability,
	ProviderConfig,
} from "../types/index";
import {
	buildOpenAICompatibleProviderDefaults,
	type OpenAICompatibleProviderDefaults,
} from "./openai-compatible";

/**
 * Provider defaults for OpenAI-compatible providers
 */
export interface ProviderDefaults {
	/** Base URL for the API */
	baseUrl: string;
	/** Default model ID */
	modelId: string;
	/** Known models with their info */
	knownModels?: Record<string, ModelInfo>;
	/** Capabilities this provider supports */
	capabilities?: ProviderCapability[];
}

export const DEFAULT_MODELS_CATALOG_URL = "https://models.dev/api.json";
const DEFAULT_MODELS_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PRIVATE_MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

const MODELS_CATALOG_CACHE = new Map<
	string,
	{ expiresAt: number; data: Record<string, Record<string, ModelInfo>> }
>();
const MODELS_CATALOG_IN_FLIGHT = new Map<
	string,
	Promise<Record<string, Record<string, ModelInfo>>>
>();
const PRIVATE_MODELS_CACHE = new Map<
	string,
	{ expiresAt: number; data: Record<string, ModelInfo> }
>();
const PRIVATE_MODELS_IN_FLIGHT = new Map<
	string,
	Promise<Record<string, ModelInfo>>
>();

let generatedModelsLoader:
	| Promise<Record<string, Record<string, ModelInfo>>>
	| undefined;

async function loadGeneratedProviderModels(): Promise<
	Record<string, Record<string, ModelInfo>>
> {
	generatedModelsLoader ??= import("../../models/generated-access").then(
		({ getGeneratedProviderModels }) => getGeneratedProviderModels(),
	);
	return generatedModelsLoader;
}

async function mergeKnownModels(
	providerId: string,
	defaultKnownModels: Record<string, ModelInfo> = {},
	liveModels: Record<string, ModelInfo> = {},
	privateModels: Record<string, ModelInfo> = {},
	userKnownModels: Record<string, ModelInfo> = {},
): Promise<Record<string, ModelInfo>> {
	const generatedProviderModels = await loadGeneratedProviderModels();
	const generatedKeys = resolveProviderModelCatalogKeys(providerId);
	const generated = Object.assign(
		{},
		...generatedKeys.map(
			(generatedKey) => generatedProviderModels[generatedKey] ?? {},
		),
	);
	return sortModelsByReleaseDate({
		...generated,
		...defaultKnownModels,
		...liveModels,
		...privateModels,
		...userKnownModels,
	});
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
	const value = baseUrl?.trim();
	return value && value.length > 0 ? value : "";
}

function resolveAuthToken(
	config: Pick<ProviderConfig, "apiKey" | "accessToken">,
): string | undefined {
	const token = config.apiKey?.trim() || config.accessToken?.trim();
	return token && token.length > 0 ? token : undefined;
}

function fingerprint(value: string): string {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i += 1) {
		hash ^= value.charCodeAt(i);
		hash +=
			(hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
	}
	return (hash >>> 0).toString(16);
}

function resolvePrivateCacheKey(
	providerId: string,
	config: ProviderConfig,
): string {
	return `${providerId}:${normalizeBaseUrl(config.baseUrl)}:${fingerprint(resolveAuthToken(config) ?? "")}`;
}

function includeCapability(
	capabilities: NonNullable<ModelInfo["capabilities"]>,
	capability: NonNullable<ModelInfo["capabilities"]>[number],
	when: boolean,
): void {
	if (when && !capabilities.includes(capability)) {
		capabilities.push(capability);
	}
}

function buildModelFromPrivateSource(
	id: string,
	input: {
		name?: string;
		contextWindow?: number;
		maxTokens?: number;
		supportsImages?: boolean;
		supportsPromptCache?: boolean;
		supportsReasoning?: boolean;
		releaseDate?: string;
	},
): ModelInfo {
	const capabilities: NonNullable<ModelInfo["capabilities"]> = [
		"streaming",
		"tools",
	];
	includeCapability(capabilities, "images", Boolean(input.supportsImages));
	includeCapability(
		capabilities,
		"prompt-cache",
		Boolean(input.supportsPromptCache),
	);
	includeCapability(
		capabilities,
		"reasoning",
		Boolean(input.supportsReasoning),
	);
	return {
		id,
		name: input.name ?? id,
		contextWindow: input.contextWindow,
		maxTokens: input.maxTokens,
		capabilities,
		releaseDate: input.releaseDate,
		status: "active",
	};
}

interface BasetenModelResponse {
	id?: string;
	object?: string;
	supported_features?: string[];
	context_length?: number;
	max_completion_tokens?: number;
}

async function fetchBasetenPrivateModels(
	_config: ProviderConfig,
	token: string,
): Promise<Record<string, ModelInfo>> {
	const response = await fetch("https://inference.baseten.co/v1/models", {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
	});
	if (!response.ok) {
		throw new Error(`Baseten model refresh failed: HTTP ${response.status}`);
	}

	const payload = (await response.json()) as { data?: BasetenModelResponse[] };
	const entries = payload?.data ?? [];
	const models: Record<string, ModelInfo> = {};
	for (const model of entries) {
		const id = model.id?.trim();
		if (!id) {
			continue;
		}
		if (
			id.includes("whisper") ||
			id.includes("tts") ||
			id.includes("embedding")
		) {
			continue;
		}
		const features = model.supported_features ?? [];
		models[id] = buildModelFromPrivateSource(id, {
			name: id,
			contextWindow: model.context_length,
			maxTokens: model.max_completion_tokens,
			supportsReasoning:
				features.includes("reasoning") || features.includes("reasoning_effort"),
			supportsImages: false,
		});
	}
	return models;
}

interface HicapModelResponse {
	id?: string;
}

async function fetchHicapPrivateModels(
	_config: ProviderConfig,
	token: string,
): Promise<Record<string, ModelInfo>> {
	const response = await fetch("https://api.hicap.ai/v2/openai/models", {
		method: "GET",
		headers: {
			"api-key": token,
		},
	});
	if (!response.ok) {
		throw new Error(`Hicap model refresh failed: HTTP ${response.status}`);
	}

	const payload = (await response.json()) as { data?: HicapModelResponse[] };
	const entries = payload?.data ?? [];
	const models: Record<string, ModelInfo> = {};
	for (const model of entries) {
		const id = model.id?.trim();
		if (!id) {
			continue;
		}
		models[id] = buildModelFromPrivateSource(id, {
			name: id,
			contextWindow: 128_000,
			supportsImages: true,
			supportsPromptCache: true,
		});
	}
	return models;
}

interface LiteLlmModelInfoResponse {
	model_name?: string;
	litellm_params?: {
		model?: string;
	};
	model_info?: {
		max_output_tokens?: number;
		max_tokens?: number;
		max_input_tokens?: number;
		supports_vision?: boolean;
		supports_prompt_caching?: boolean;
		supports_reasoning?: boolean;
	};
}

function normalizeLiteLlmBaseUrl(baseUrl: string | undefined): string {
	const normalized = normalizeBaseUrl(baseUrl);
	if (!normalized) {
		return "http://localhost:4000";
	}
	return normalized.endsWith("/v1") ? normalized.slice(0, -3) : normalized;
}

async function fetchLiteLlmPrivateModels(
	config: ProviderConfig,
	token: string,
): Promise<Record<string, ModelInfo>> {
	const baseUrl = normalizeLiteLlmBaseUrl(config.baseUrl);
	const endpoint = `${baseUrl}/v1/model/info`;

	const fetchWithHeaders = async (
		headers: Record<string, string>,
	): Promise<Response> =>
		fetch(endpoint, {
			method: "GET",
			headers: {
				accept: "application/json",
				...headers,
			},
		});

	let response = await fetchWithHeaders({ "x-litellm-api-key": token });
	if (!response.ok) {
		response = await fetchWithHeaders({ Authorization: `Bearer ${token}` });
	}
	if (!response.ok) {
		throw new Error(`LiteLLM model refresh failed: HTTP ${response.status}`);
	}

	const payload = (await response.json()) as {
		data?: LiteLlmModelInfoResponse[];
	};
	const entries = payload?.data ?? [];
	const models: Record<string, ModelInfo> = {};
	for (const model of entries) {
		const displayName = model.model_name?.trim();
		const actualModelId = model.litellm_params?.model?.trim();
		const modelId = actualModelId || displayName;
		if (!modelId) {
			continue;
		}
		const info = model.model_info;
		const converted = buildModelFromPrivateSource(modelId, {
			name: displayName ?? modelId,
			maxTokens: info?.max_output_tokens ?? info?.max_tokens,
			contextWindow: info?.max_input_tokens ?? info?.max_tokens,
			supportsImages: info?.supports_vision,
			supportsPromptCache: info?.supports_prompt_caching,
			supportsReasoning: info?.supports_reasoning,
		});
		models[modelId] = converted;
		if (displayName) {
			models[displayName] = {
				...converted,
				id: displayName,
				name: displayName,
			};
		}
	}
	return models;
}

async function fetchPrivateProviderModels(
	providerId: string,
	config: ProviderConfig,
): Promise<Record<string, ModelInfo>> {
	const token = resolveAuthToken(config);
	if (!token) {
		return {};
	}

	const fetcher = PRIVATE_PROVIDER_MODEL_FETCHERS[providerId];
	if (!fetcher) {
		return {};
	}
	return fetcher(config, token);
}

type PrivateProviderModelFetcher = (
	config: ProviderConfig,
	token: string,
) => Promise<Record<string, ModelInfo>>;

const PRIVATE_PROVIDER_MODEL_FETCHERS: Record<
	string,
	PrivateProviderModelFetcher
> = {
	baseten: fetchBasetenPrivateModels,
	hicap: fetchHicapPrivateModels,
	litellm: fetchLiteLlmPrivateModels,
};

function shouldLoadPrivateModels(
	providerId: string,
	modelCatalog: ModelCatalogConfig | undefined,
	config: ProviderConfig | undefined,
): boolean {
	if (!config) {
		return false;
	}
	if (!PRIVATE_PROVIDER_MODEL_FETCHERS[providerId]) {
		return false;
	}
	if (modelCatalog?.loadPrivateOnAuth === false) {
		return false;
	}
	return Boolean(resolveAuthToken(config));
}

async function getPrivateProviderModels(
	providerId: string,
	modelCatalog: ModelCatalogConfig | undefined,
	config: ProviderConfig,
): Promise<Record<string, ModelInfo>> {
	const cacheTtlMs =
		modelCatalog?.cacheTtlMs ?? DEFAULT_PRIVATE_MODELS_CACHE_TTL_MS;
	const cacheKey = resolvePrivateCacheKey(providerId, config);
	const now = Date.now();

	const cached = PRIVATE_MODELS_CACHE.get(cacheKey);
	if (cached && cached.expiresAt > now) {
		return cached.data;
	}

	const inFlight = PRIVATE_MODELS_IN_FLIGHT.get(cacheKey);
	if (inFlight) {
		return inFlight;
	}

	const request = fetchPrivateProviderModels(providerId, config)
		.then((data) => {
			PRIVATE_MODELS_CACHE.set(cacheKey, {
				data,
				expiresAt: now + cacheTtlMs,
			});
			return data;
		})
		.finally(() => {
			PRIVATE_MODELS_IN_FLIGHT.delete(cacheKey);
		});

	PRIVATE_MODELS_IN_FLIGHT.set(cacheKey, request);
	return request;
}

async function fetchLiveModelsCatalog(
	url: string,
): Promise<Record<string, Record<string, ModelInfo>>> {
	return fetchModelsDevProviderModels(url, MODELS_DEV_PROVIDER_KEY_MAP);
}

export async function getLiveModelsCatalog(
	options: Pick<ModelCatalogConfig, "url" | "cacheTtlMs"> = {},
): Promise<Record<string, Record<string, ModelInfo>>> {
	const url = options.url ?? DEFAULT_MODELS_CATALOG_URL;
	const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_MODELS_CATALOG_CACHE_TTL_MS;
	const now = Date.now();

	const cached = MODELS_CATALOG_CACHE.get(url);
	if (cached && cached.expiresAt > now) {
		return cached.data;
	}

	const inFlight = MODELS_CATALOG_IN_FLIGHT.get(url);
	if (inFlight) {
		return inFlight;
	}

	const request = fetchLiveModelsCatalog(url)
		.then((data) => {
			MODELS_CATALOG_CACHE.set(url, { data, expiresAt: now + cacheTtlMs });
			return data;
		})
		.finally(() => {
			MODELS_CATALOG_IN_FLIGHT.delete(url);
		});

	MODELS_CATALOG_IN_FLIGHT.set(url, request);
	return request;
}

export function clearLiveModelsCatalogCache(url?: string): void {
	if (url) {
		MODELS_CATALOG_CACHE.delete(url);
		MODELS_CATALOG_IN_FLIGHT.delete(url);
		return;
	}

	MODELS_CATALOG_CACHE.clear();
	MODELS_CATALOG_IN_FLIGHT.clear();
}

export function clearPrivateModelsCatalogCache(): void {
	PRIVATE_MODELS_CACHE.clear();
	PRIVATE_MODELS_IN_FLIGHT.clear();
}

function toRuntimeProviderDefaults(
	defaults: Record<string, OpenAICompatibleProviderDefaults>,
): Record<string, ProviderDefaults> {
	return Object.fromEntries(
		Object.entries(defaults).map(([providerId, providerDefaults]) => [
			providerId,
			{
				baseUrl: providerDefaults.baseUrl,
				modelId: providerDefaults.modelId,
				knownModels: providerDefaults.knownModels,
				capabilities: providerDefaults.capabilities as
					| ProviderCapability[]
					| undefined,
			},
		]),
	);
}

/**
 * All OpenAI-compatible provider configurations
 *
 * Model data is sourced from @clinebot/models to maintain a single source of truth.
 */
export const OPENAI_COMPATIBLE_PROVIDERS: Record<string, ProviderDefaults> =
	toRuntimeProviderDefaults(buildOpenAICompatibleProviderDefaults());

/**
 * Get provider configuration by ID
 */
export function getProviderConfig(
	providerId: string,
): ProviderDefaults | undefined {
	return OPENAI_COMPATIBLE_PROVIDERS[providerId];
}

/**
 * Resolve provider configuration and optionally merge live catalog metadata
 */
export async function resolveProviderConfig(
	providerId: string,
	modelCatalog?: ModelCatalogConfig,
	config?: ProviderConfig,
): Promise<ProviderDefaults | undefined> {
	const defaults = getProviderConfig(providerId);
	if (!defaults) {
		return undefined;
	}

	try {
		const liveCatalog = modelCatalog?.loadLatestOnInit
			? await getLiveModelsCatalog(modelCatalog)
			: undefined;
		const liveModels = liveCatalog?.[providerId] ?? {};
		const privateModels =
			config && shouldLoadPrivateModels(providerId, modelCatalog, config)
				? await getPrivateProviderModels(providerId, modelCatalog, config)
				: {};
		const knownModels = await mergeKnownModels(
			providerId,
			defaults.knownModels,
			liveModels,
			privateModels,
			config?.knownModels,
		);

		return {
			...defaults,
			knownModels,
		};
	} catch (error) {
		if (modelCatalog?.failOnError) {
			throw error;
		}
		return defaults;
	}
}

/**
 * Check if a provider is OpenAI-compatible
 */
export function isOpenAICompatibleProvider(providerId: string): boolean {
	return providerId in OPENAI_COMPATIBLE_PROVIDERS;
}

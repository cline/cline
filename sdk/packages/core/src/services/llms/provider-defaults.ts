/** biome-ignore-all lint/style/noNonNullAssertion: static */

import * as Llms from "@cline/llms";
import {
	fetchModelIdsFromSource,
	resolveModelsSourceUrl,
} from "../providers/model-source";
import type {
	ModelCatalogConfig,
	ModelInfo,
	ProviderCapability,
	ProviderConfig,
} from "./provider-settings";

export interface BuiltInProviderManifest {
	id: string;
	baseUrl: string;
	modelsSourceUrl?: string;
	modelId: string;
	knownModels?: Record<string, ModelInfo>;
	capabilities?: Llms.CatalogProviderCapability[];
	env?: readonly string[];
	client: Llms.ProviderClient;
	protocol?: Llms.ProviderProtocol;
}

function cloneKnownModels(
	models: Record<string, ModelInfo>,
): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(models).map(([id, info]) => [id, { ...info }]),
	) as Record<string, ModelInfo>;
}

function isOpenAICompatibleManifest(
	manifest: BuiltInProviderManifest,
): boolean {
	if (manifest.baseUrl.length === 0) {
		return false;
	}
	switch (manifest.client) {
		case "openai-compatible":
		case "openai":
		case "openai-r1":
		case "fetch":
			return true;
		default:
			return manifest.protocol === "openai-chat";
	}
}

const BUILTIN_PROVIDER_MANIFESTS: BuiltInProviderManifest[] = Object.values(
	Llms.MODEL_COLLECTIONS_BY_PROVIDER_ID,
).map((collection) => ({
	id: collection.provider.id,
	baseUrl: collection.provider.baseUrl ?? "",
	modelsSourceUrl: collection.provider.modelsSourceUrl,
	modelId: collection.provider.defaultModelId,
	knownModels: cloneKnownModels(collection.models),
	capabilities: collection.provider.capabilities
		? [...collection.provider.capabilities]
		: undefined,
	env: collection.provider.env ? [...collection.provider.env] : undefined,
	client: collection.provider.client,
	protocol: collection.provider.protocol,
}));

const BUILTIN_PROVIDER_MANIFESTS_BY_ID: Record<
	string,
	BuiltInProviderManifest
> = Object.fromEntries(
	BUILTIN_PROVIDER_MANIFESTS.map((manifest) => [manifest.id, manifest]),
);

function getBuiltInProviderManifest(
	providerId: string,
): BuiltInProviderManifest | undefined {
	return BUILTIN_PROVIDER_MANIFESTS_BY_ID[providerId];
}

function getOpenAICompatibleProviderManifests(): Record<
	string,
	BuiltInProviderManifest
> {
	return Object.fromEntries(
		Object.entries(BUILTIN_PROVIDER_MANIFESTS_BY_ID).filter(([, manifest]) =>
			isOpenAICompatibleManifest(manifest),
		),
	);
}

export interface ProviderDefaults {
	baseUrl?: string;
	modelId: string;
	knownModels?: Record<string, ModelInfo>;
	capabilities?: ProviderCapability[];
}

function toRuntimeCapabilities(
	capabilities: readonly Llms.CatalogProviderCapability[] = [],
): ProviderCapability[] | undefined {
	const next = capabilities.flatMap((capability) => {
		switch (capability) {
			case "reasoning":
			case "prompt-cache":
			case "tools":
			case "oauth":
				return [capability satisfies ProviderCapability];
			default:
				return [];
		}
	});
	return next.length > 0 ? next : undefined;
}

export const DEFAULT_MODELS_CATALOG_URL = "https://models.dev/api.json";
const DEFAULT_MODELS_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PRIVATE_MODELS_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_PRIVATE_MODELS_REQUEST_TIMEOUT_MS = 5_000;

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

async function loadGeneratedProviderModels(): Promise<
	Record<string, Record<string, ModelInfo>>
> {
	return Llms.getGeneratedProviderModels();
}

async function mergeKnownModels(
	providerId: string,
	defaultKnownModels: Record<string, ModelInfo> = {},
	liveModels: Record<string, ModelInfo> = {},
	privateModels: Record<string, ModelInfo> = {},
	publicModels: Record<string, ModelInfo> = {},
	userKnownModels: Record<string, ModelInfo> = {},
): Promise<Record<string, ModelInfo>> {
	const generatedProviderModels = await loadGeneratedProviderModels();
	const generatedKeys = Llms.resolveProviderModelCatalogKeys(providerId);
	const generated = Object.assign(
		{},
		...generatedKeys.map(
			(generatedKey) => generatedProviderModels[generatedKey] ?? {},
		),
	);
	// For providers with a registered public model source (Ollama, LM Studio),
	// the live response is the authoritative list of what the user has
	// actually installed. Skip the bundled catalog so the picker doesn't
	// show models that aren't downloaded.
	const hasPublicModelSource = Boolean(
		Llms.MODEL_COLLECTIONS_BY_PROVIDER_ID[providerId]?.provider.modelsSourceUrl,
	);
	const publicHasResults = Object.keys(publicModels).length > 0;
	if (hasPublicModelSource && publicHasResults) {
		return Llms.sortModelsByReleaseDate({
			...publicModels,
			...userKnownModels,
		});
	}
	if (providerId === "openai-codex") {
		return Llms.sortModelsByReleaseDate({
			...defaultKnownModels,
			...Llms.filterOpenAICodexModels(liveModels),
			...publicModels,
			...userKnownModels,
		});
	}
	return Llms.sortModelsByReleaseDate({
		...generated,
		...defaultKnownModels,
		...liveModels,
		...privateModels,
		...publicModels,
		...userKnownModels,
	});
}

function resolveCatalogModels(
	providerId: string,
	modelsByProviderId: Record<string, Record<string, ModelInfo>>,
): Record<string, ModelInfo> {
	// Runtime provider ids do not always match catalog keys. For example,
	// Cline uses OpenRouter-backed catalog models, so live catalog lookups must
	// apply the same key mapping as generated catalog lookups.
	const catalogKeys = Llms.resolveProviderModelCatalogKeys(providerId);
	return Object.assign(
		{},
		...catalogKeys.map((catalogKey) => modelsByProviderId[catalogKey] ?? {}),
	);
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
	const sap = config.sap;
	const authPayload =
		providerId === "sapaicore"
			? [
						sap?.clientId,
						sap?.clientSecret ?? config.apiKey,
						sap?.tokenUrl,
						sap?.resourceGroup,
						sap?.deploymentId,
					sap?.useOrchestrationMode,
					sap?.api,
				].join("\0")
			: (resolveAuthToken(config) ?? "");
	return `${providerId}:${normalizeBaseUrl(config.baseUrl)}:${fingerprint(authPayload)}`;
}

async function fetchWithTimeout(
	input: string,
	init: RequestInit,
	timeoutMs = DEFAULT_PRIVATE_MODELS_REQUEST_TIMEOUT_MS,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(input, {
			...init,
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
	}
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
		maxInputTokens?: number;
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
		maxInputTokens: input.maxInputTokens,
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
	const response = await fetchWithTimeout(
		"https://inference.baseten.co/v1/models",
		{
			method: "GET",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
		},
	);
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
			maxInputTokens: model.context_length,
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

interface PoolsideModelResponse {
	id?: string;
	name?: string;
	description?: string;
	context_length?: number;
	max_completion_tokens?: number;
	supported_features?: string[];
	supported_sampling_parameters?: string[];
	input_modalities?: string[];
	pricing?: {
		prompt?: number | string;
		completion?: number | string;
	};
}

function parseOptionalNumber(
	value: number | string | undefined,
): number | undefined {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

async function fetchHicapPrivateModels(
	_config: ProviderConfig,
	token: string,
): Promise<Record<string, ModelInfo>> {
	const response = await fetchWithTimeout(
		"https://api.hicap.ai/v2/openai/models",
		{
			method: "GET",
			headers: {
				"api-key": token,
			},
		},
	);
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
			maxInputTokens: 128_000,
			supportsImages: true,
			supportsPromptCache: true,
		});
	}
	return models;
}

async function fetchPoolsidePrivateModels(
	config: ProviderConfig,
	token: string,
): Promise<Record<string, ModelInfo>> {
	const baseUrl =
		normalizeBaseUrl(config.baseUrl) || "https://inference.poolside.ai/v1";
	const endpoint = `${baseUrl.replace(/\/+$/, "")}/models`;
	const response = await fetchWithTimeout(endpoint, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token}`,
			accept: "application/json",
		},
	});
	if (!response.ok) {
		throw new Error(`Poolside model refresh failed: HTTP ${response.status}`);
	}

	const payload = (await response.json()) as { data?: PoolsideModelResponse[] };
	const entries = payload?.data ?? [];
	const models: Record<string, ModelInfo> = {};
	for (const model of entries) {
		const id = model.id?.trim();
		if (!id) {
			continue;
		}

		const supportedFeatures = model.supported_features ?? [];
		const supportedSamplingParameters =
			model.supported_sampling_parameters ?? [];
		const inputModalities = model.input_modalities ?? [];
		const capabilities: NonNullable<ModelInfo["capabilities"]> = ["streaming"];
		includeCapability(
			capabilities,
			"tools",
			supportedFeatures.includes("tools"),
		);
		includeCapability(
			capabilities,
			"reasoning",
			supportedFeatures.includes("reasoning"),
		);
		includeCapability(
			capabilities,
			"temperature",
			supportedSamplingParameters.includes("temperature"),
		);
		includeCapability(
			capabilities,
			"images",
			inputModalities.includes("image"),
		);

		const pricing = {
			input: parseOptionalNumber(model.pricing?.prompt),
			output: parseOptionalNumber(model.pricing?.completion),
		};
		models[id] = {
			id,
			name: model.name ?? id,
			description: model.description,
			contextWindow: model.context_length,
			maxInputTokens: model.context_length,
			maxTokens: model.max_completion_tokens,
			capabilities,
			pricing:
				pricing.input !== undefined || pricing.output !== undefined
					? pricing
					: undefined,
			status: "active",
		};
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

interface OcaModelInfoResponse {
	litellm_params?: {
		model?: string;
		max_tokens?: number;
	};
	model_info?: {
		context_window?: number;
		supports_vision?: boolean;
		supports_caching?: boolean;
		input_price?: number | string;
		output_price?: number | string;
		caching_price?: number | string;
		cached_price?: number | string;
		description?: string;
		thinking_config?: ModelInfo["thinkingConfig"];
		temperature?: number;
		banner?: unknown;
		survey_content?: unknown;
		survey_id?: string;
		is_reasoning_model?: boolean;
		reasoning_effort_options?: string[];
		supported_api_list?: string[];
	};
}

interface SapTokenResponse {
	access_token?: string;
	expires_in?: number;
	token_type?: string;
}

interface SapDeploymentResponse {
	resources?: Array<{
		id?: string;
		targetStatus?: string;
		scenarioId?: string;
		details?: {
			resources?: {
				backend_details?: {
					model?: {
						name?: string;
						version?: string;
					};
				};
			};
		};
	}>;
}

function normalizeSapTokenUrl(tokenUrl: string): string {
	const trimmed = tokenUrl.replace(/\/+$/, "");
	return /\/oauth\/token$/i.test(trimmed) ? trimmed : `${trimmed}/oauth/token`;
}

function hasSapCredentials(config: ProviderConfig): boolean {
	return Boolean(
		normalizeBaseUrl(config.baseUrl) &&
			config.sap?.clientId?.trim() &&
			(config.sap.clientSecret?.trim() || config.apiKey?.trim()) &&
			config.sap.tokenUrl?.trim(),
	);
}

async function fetchSapAccessToken(config: ProviderConfig): Promise<string> {
	const clientId = config.sap?.clientId?.trim();
	const clientSecret = config.sap?.clientSecret?.trim() || config.apiKey?.trim();
	const tokenUrl = config.sap?.tokenUrl?.trim();
	if (!clientId || !clientSecret || !tokenUrl) {
		return "";
	}

	const payload = new URLSearchParams({
		grant_type: "client_credentials",
		client_id: clientId,
		client_secret: clientSecret,
	});
	const response = await fetchWithTimeout(normalizeSapTokenUrl(tokenUrl), {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: payload,
	});
	if (!response.ok) {
		throw new Error(`SAP AI Core token refresh failed: HTTP ${response.status}`);
	}
	const token = (await response.json()) as SapTokenResponse;
	return token.access_token?.trim() ?? "";
}

async function fetchSapAiCorePrivateModels(
	config: ProviderConfig,
	_token: string,
): Promise<Record<string, ModelInfo>> {
	if (!hasSapCredentials(config)) {
		return {};
	}

	const accessToken = await fetchSapAccessToken(config);
	if (!accessToken) {
		return {};
	}

	const baseUrl = normalizeBaseUrl(config.baseUrl).replace(/\/+$/, "");
	const resourceGroup = config.sap?.resourceGroup?.trim() || "default";
	const response = await fetchWithTimeout(
		`${baseUrl}/v2/lm/deployments?$top=10000&$skip=0`,
		{
			method: "GET",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"AI-Resource-Group": resourceGroup,
				"Content-Type": "application/json",
				"AI-Client-Type": "Cline",
			},
		},
	);
	if (!response.ok) {
		throw new Error(
			`SAP AI Core deployment refresh failed: HTTP ${response.status}`,
		);
	}

	const payload = (await response.json()) as SapDeploymentResponse;
	const models: Record<string, ModelInfo> = {};
	for (const deployment of payload.resources ?? []) {
		if (deployment.targetStatus !== "RUNNING") {
			continue;
		}
		const deploymentId = deployment.id?.trim();
		const model = deployment.details?.resources?.backend_details?.model;
		const modelName = model?.name?.trim().toLowerCase();
			if (!deploymentId || !modelName) {
				continue;
			}
			const modelVersion = model?.version?.trim();
			const displayName = modelVersion
				? `${modelName}:${modelVersion}`
				: modelName;
			const modelId = `${modelName}:${deploymentId}`;
			models[modelId] = {
				...buildModelFromPrivateSource(modelId, { name: displayName }),
				metadata: {
					sap: {
						modelName,
						deploymentId,
						resourceGroup,
						orchestrationAvailable: deployment.scenarioId === "orchestration",
					},
				},
			};
	}
	return models;
}

function parseOcaPrice(value: number | string | undefined): number | undefined {
	const parsed = parseOptionalNumber(value);
	return parsed === undefined ? undefined : parsed * 1_000_000;
}

function createOcaRequestId(): string {
	if (typeof globalThis.crypto?.randomUUID === "function") {
		return globalThis.crypto.randomUUID();
	}
	return `cline-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

async function fetchOcaPrivateModels(
	config: ProviderConfig,
	token: string,
): Promise<Record<string, ModelInfo>> {
	if (!token) {
		return {};
	}
	const manifestDefaultBaseUrl = getBuiltInProviderManifest("oca")?.baseUrl ?? "";
	const baseUrl = (
		normalizeBaseUrl(config.baseUrl) || manifestDefaultBaseUrl
	).replace(/\/+$/, "");
	if (!baseUrl) {
		return {};
	}
	const response = await fetchWithTimeout(`${baseUrl}/v1/model/info`, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			client: "Cline",
			"opc-request-id": createOcaRequestId(),
		},
	});
	if (!response.ok) {
		throw new Error(`OCA model refresh failed: HTTP ${response.status}`);
	}

	const payload = (await response.json()) as { data?: OcaModelInfoResponse[] };
	const models: Record<string, ModelInfo> = {};
	for (const entry of payload?.data ?? []) {
		const id = entry.litellm_params?.model?.trim();
		if (!id) {
			continue;
		}
		const info = entry.model_info;
		const capabilities: NonNullable<ModelInfo["capabilities"]> = [
			"streaming",
			"tools",
		];
		includeCapability(capabilities, "images", Boolean(info?.supports_vision));
		includeCapability(
			capabilities,
			"prompt-cache",
			Boolean(info?.supports_caching),
		);
		includeCapability(
			capabilities,
			"reasoning",
			Boolean(info?.is_reasoning_model),
		);
		includeCapability(
			capabilities,
			"reasoning-effort",
			Boolean(info?.reasoning_effort_options?.length),
		);
		const pricing = {
			input: parseOcaPrice(info?.input_price),
			output: parseOcaPrice(info?.output_price),
			cacheWrite: parseOcaPrice(info?.caching_price),
			cacheRead: parseOcaPrice(info?.cached_price),
		};
		models[id] = {
			id,
			name: id,
			contextWindow: info?.context_window,
			maxInputTokens: info?.context_window,
			maxTokens: entry.litellm_params?.max_tokens,
			capabilities,
			description: info?.description,
			temperature: info?.temperature,
			thinkingConfig: info?.thinking_config,
			pricing:
				pricing.input !== undefined ||
				pricing.output !== undefined ||
				pricing.cacheWrite !== undefined ||
				pricing.cacheRead !== undefined
					? pricing
					: undefined,
			apiFormat: info?.supported_api_list?.includes("RESPONSES")
				? "openai-responses"
				: undefined,
			status: "active",
			metadata: {
				oca: {
					banner: info?.banner,
					surveyContent: info?.survey_content,
					surveyId: info?.survey_id,
					reasoningEffortOptions: info?.reasoning_effort_options ?? [],
					supportedApiList: info?.supported_api_list ?? [],
				},
			},
		};
	}
	return models;
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
		fetchWithTimeout(endpoint, {
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
			maxInputTokens: info?.max_input_tokens ?? info?.max_tokens,
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
	oca: fetchOcaPrivateModels,
	poolside: fetchPoolsidePrivateModels,
	sapaicore: fetchSapAiCorePrivateModels,
};

const PUBLIC_MODELS_CACHE = new Map<
	string,
	{ data: Record<string, ModelInfo>; expiresAt: number }
>();
const PUBLIC_MODELS_IN_FLIGHT = new Map<
	string,
	Promise<Record<string, ModelInfo>>
>();

function resolvePublicCacheKey(
	providerId: string,
	config: ProviderConfig,
): string {
	return `${providerId}:${normalizeBaseUrl(config.baseUrl)}`;
}

async function getPublicProviderModels(
	providerId: string,
	modelCatalog: ModelCatalogConfig | undefined,
	config: ProviderConfig,
): Promise<Record<string, ModelInfo>> {
	const collection = Llms.MODEL_COLLECTIONS_BY_PROVIDER_ID[providerId];
	const sourceUrl = resolveModelsSourceUrl(
		config.baseUrl,
		collection?.provider.baseUrl,
		collection?.provider.modelsSourceUrl,
	);
	if (!sourceUrl) {
		return {};
	}
	const cacheTtlMs =
		modelCatalog?.cacheTtlMs ?? DEFAULT_PRIVATE_MODELS_CACHE_TTL_MS;
	const cacheKey = resolvePublicCacheKey(providerId, config);
	const now = Date.now();

	const cached = PUBLIC_MODELS_CACHE.get(cacheKey);
	if (cached && cached.expiresAt > now) {
		return cached.data;
	}

	const inFlight = PUBLIC_MODELS_IN_FLIGHT.get(cacheKey);
	if (inFlight) {
		return inFlight;
	}

	const request = fetchModelIdsFromSource(sourceUrl, providerId)
		.then((modelIds) => {
			const data = Object.fromEntries(
				modelIds.map((id) => [
					id,
					buildModelFromPrivateSource(id, { name: id }),
				]),
			);
			PUBLIC_MODELS_CACHE.set(cacheKey, {
				data,
				expiresAt: now + cacheTtlMs,
			});
			return data;
		})
		.finally(() => {
			PUBLIC_MODELS_IN_FLIGHT.delete(cacheKey);
		});

	PUBLIC_MODELS_IN_FLIGHT.set(cacheKey, request);
	return request;
}

export function clearPublicModelsCatalogCache(): void {
	PUBLIC_MODELS_CACHE.clear();
	PUBLIC_MODELS_IN_FLIGHT.clear();
}

async function fetchPrivateProviderModels(
	providerId: string,
	config: ProviderConfig,
): Promise<Record<string, ModelInfo>> {
	const token = resolveAuthToken(config);
	if (!token && providerId !== "sapaicore") {
		return {};
	}

	const fetcher = PRIVATE_PROVIDER_MODEL_FETCHERS[providerId];
	if (!fetcher) {
		return {};
	}
	return fetcher(config, token ?? "");
}

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
	if (providerId === "sapaicore") {
		return hasSapCredentials(config);
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
	return Llms.fetchModelsDevProviderModels(url, globalThis.fetch);
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
	manifests: ReturnType<typeof getOpenAICompatibleProviderManifests>,
): Record<string, ProviderDefaults> {
	return Object.fromEntries(
		Object.entries(manifests).map(([providerId, manifest]) => [
			providerId,
			{
				baseUrl: manifest.baseUrl,
				modelId: manifest.modelId,
				capabilities: toRuntimeCapabilities(manifest.capabilities),
			},
		]),
	);
}

export const OPENAI_COMPATIBLE_PROVIDERS: Record<string, ProviderDefaults> =
	toRuntimeProviderDefaults(getOpenAICompatibleProviderManifests());

export function getProviderConfig(
	providerId: string,
): ProviderDefaults | undefined {
	const manifest = getBuiltInProviderManifest(providerId);
	if (!manifest) {
		return undefined;
	}

	return {
		baseUrl: manifest.baseUrl || undefined,
		modelId: manifest.modelId,
		knownModels: manifest.knownModels,
		capabilities: toRuntimeCapabilities(manifest.capabilities),
	};
}

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
		const liveModels = liveCatalog
			? resolveCatalogModels(providerId, liveCatalog)
			: {};
		const privateModels =
			config && shouldLoadPrivateModels(providerId, modelCatalog, config)
				? await getPrivateProviderModels(providerId, modelCatalog, config)
				: {};
		// Public (keyless) live model sources run whenever `modelsSourceUrl` is
		// registered for the provider — even if the caller didn't pass a
		// `config`. Falls back to the spec's default base URL so a fresh install
		// still hits the default local model endpoint. Failures are swallowed
		// below, so an unreachable server just leaves the picker on the bundled
		// catalog.
		const hasPublicModelSource = Boolean(
			Llms.MODEL_COLLECTIONS_BY_PROVIDER_ID[providerId]?.provider
				.modelsSourceUrl,
		);
		const publicConfig: ProviderConfig | undefined = hasPublicModelSource
			? (config ?? {
					providerId: providerId as ProviderConfig["providerId"],
					modelId: defaults.modelId,
					baseUrl: defaults.baseUrl,
				})
			: config;
		const publicModels = publicConfig
			? await getPublicProviderModels(
					providerId,
					modelCatalog,
					publicConfig,
				).catch(() => ({}))
			: {};
		const knownModels = await mergeKnownModels(
			providerId,
			defaults.knownModels,
			liveModels,
			privateModels,
			publicModels,
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

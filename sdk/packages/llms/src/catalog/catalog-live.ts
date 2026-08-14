import {
	MODELS_DEV_BLOCKED_PROVIDER_IDS,
	MODELS_DEV_CURRENT_BUILTIN_PROVIDER_KEYS,
	resolveGeneratedProviderIdForModelsDevKey,
} from "../providers/provider-keys";
import {
	fetchClineRecommendedModelsPayload,
	normalizeClineRecommendedProviderModels,
} from "./catalog-cline-recommended";
import type { ModelInfo, ModelModality } from "./types";

export interface ModelsDevModel {
	name?: string;
	tool_call?: boolean;
	reasoning?: boolean;
	reasoning_options?: ModelInfo["reasoningOptions"];
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
		output?: string[];
	};
	status?: string;
}

interface ModelsDevProviderPayload {
	id?: string;
	env?: string[];
	npm?: string;
	api?: string;
	name?: string;
	doc?: string;
	models?: Record<string, ModelsDevModel>;
}

export type ModelsDevPayload = Record<string, ModelsDevProviderPayload>;
export type ModelsDevProviderKeyMap = Record<string, string>;

export interface ModelsDevGeneratedProviderSpec {
	id: string;
	name: string;
	description: string;
	family:
		| "openai"
		| "openai-compatible"
		| "anthropic"
		| "google"
		| "vertex"
		| "bedrock"
		| "mistral";
	capabilities?: ("tools" | "reasoning" | "prompt-cache")[];
	modelsProviderId: string;
	defaultModelId?: string;
	apiKeyEnv?: string[];
	docsUrl?: string;
	defaults?: {
		baseUrl?: string;
	};
}

interface SelectedModelsDevProvider {
	sourceProviderKey: string;
	targetProviderId: string;
	source: ModelsDevProviderPayload;
}

const DEFAULT_MAX_INPUT_TOKENS = 128_000;
const DEFAULT_MAX_TOKENS = 4096;

// Non-tool models are only useful to the voice-input catalog when the current
// runtime can send them through its OpenAI-compatible (or provider-specific)
// transcription transport. Keep this list intentionally explicit: a provider
// advertising audio modalities does not imply that its chat base URL exposes
// POST /audio/transcriptions.
const TRANSCRIPTION_TRANSPORT_PROVIDER_IDS = new Set([
	"evroc",
	"groq",
	"mistral",
	"nearai",
	"openai-native",
	"privatemode-ai",
	"scaleway",
	"vercel-ai-gateway",
]);

const MODELS_DEV_AI_SDK_PROVIDER_FAMILIES = {
	"@ai-sdk/openai": "openai",
	"@ai-sdk/openai-compatible": "openai-compatible",
	"@ai-sdk/anthropic": "anthropic",
	"@ai-sdk/google": "google",
	"@ai-sdk/google-vertex": "vertex",
	"@ai-sdk/amazon-bedrock": "bedrock",
	"@ai-sdk/mistral": "mistral",
} as const satisfies Record<string, ModelsDevGeneratedProviderSpec["family"]>;

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

function supportedAiSdkProviderFamily(
	provider: ModelsDevProviderPayload,
): ModelsDevGeneratedProviderSpec["family"] | undefined {
	if (!provider.npm) {
		return undefined;
	}
	return MODELS_DEV_AI_SDK_PROVIDER_FAMILIES[
		provider.npm as keyof typeof MODELS_DEV_AI_SDK_PROVIDER_FAMILIES
	];
}

function usesSupportedAiSdkProvider(
	provider: ModelsDevProviderPayload,
): boolean {
	return supportedAiSdkProviderFamily(provider) !== undefined;
}

function selectedTargetProviderId(
	sourceProviderKey: string,
	source: ModelsDevProviderPayload,
): string | undefined {
	const mappedProviderId =
		resolveGeneratedProviderIdForModelsDevKey(sourceProviderKey);
	if (mappedProviderId) {
		return mappedProviderId;
	}
	if (usesSupportedAiSdkProvider(source)) {
		return source.id || sourceProviderKey;
	}
	return undefined;
}

function getSelectedModelsDevProviders(
	payload: ModelsDevPayload,
): SelectedModelsDevProvider[] {
	const selected: SelectedModelsDevProvider[] = [];
	const usedProviderIds = new Set<string>();

	for (const [sourceProviderKey, source] of Object.entries(payload).sort(
		([a], [b]) => a.localeCompare(b),
	)) {
		const targetProviderId = selectedTargetProviderId(
			sourceProviderKey,
			source,
		);
		if (
			!targetProviderId ||
			MODELS_DEV_BLOCKED_PROVIDER_IDS.has(targetProviderId) ||
			usedProviderIds.has(targetProviderId)
		) {
			continue;
		}

		const isCurrentBuiltinProvider =
			MODELS_DEV_CURRENT_BUILTIN_PROVIDER_KEYS.has(sourceProviderKey);
		if (!isCurrentBuiltinProvider && !usesSupportedAiSdkProvider(source)) {
			continue;
		}

		usedProviderIds.add(targetProviderId);
		selected.push({ sourceProviderKey, targetProviderId, source });
	}

	return selected;
}

function isDedicatedTranscriptionModel(model: ModelsDevModel): boolean {
	return (
		model.modalities?.input?.length === 1 &&
		model.modalities.input[0] === "audio" &&
		model.modalities.output?.length === 1 &&
		model.modalities.output[0] === "text"
	);
}

function isStreamingTranscriptionModel(
	modelId: string,
	model: ModelsDevModel,
): boolean {
	if (!isDedicatedTranscriptionModel(model)) {
		return false;
	}

	// models.dev exposes modalities but does not currently distinguish batch
	// transcription from WebSocket-only transcription. Realtime transcription
	// models consistently carry "realtime" in their canonical model/name.
	const identity = `${modelId} ${model.name ?? ""}`.toLowerCase();
	return /(?:^|[/_.-])realtime(?:$|[/_.-])/.test(identity);
}

function toCapabilities(
	modelId: string,
	model: ModelsDevModel,
): ModelInfo["capabilities"] {
	const capabilities: NonNullable<ModelInfo["capabilities"]> = [];
	if (model.modalities?.input?.includes("image")) {
		capabilities.push("images");
	}
	if (model.modalities?.input?.includes("video")) {
		capabilities.push("video");
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
	if (isStreamingTranscriptionModel(modelId, model)) {
		capabilities.push("transcription-streaming");
	}
	if (
		(model.cost?.cache_read && model.cost?.cache_read >= 0) ||
		(model.cost?.cache_write && model.cost?.cache_write >= 0)
	) {
		capabilities.push("prompt-cache");
	}
	return Array.from(new Set(capabilities));
}

const KNOWN_MODEL_MODALITIES = new Set<ModelModality>([
	"text",
	"image",
	"audio",
	"video",
	"pdf",
]);

function toModalities(
	modalities: ModelsDevModel["modalities"],
): ModelInfo["modalities"] {
	if (!modalities) {
		return undefined;
	}
	const normalize = (values: string[] | undefined): ModelModality[] =>
		Array.from(
			new Set(
				(values ?? []).filter((value): value is ModelModality =>
					KNOWN_MODEL_MODALITIES.has(value as ModelModality),
				),
			),
		);
	const input = normalize(modalities.input);
	const output = normalize(modalities.output);
	if (!input.includes("audio") && !output.includes("audio")) {
		return undefined;
	}
	return { input, output };
}

function isChatModel(model: ModelInfo): boolean {
	return (
		(model.modalities === undefined ||
			model.modalities.input.includes("text")) &&
		(model.modalities === undefined || model.modalities.output.includes("text"))
	);
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

export function resolveMaxInputTokens(
	limit: ModelsDevModel["limit"] | undefined,
): number {
	const contextLimit = limit?.context;
	const inputLimit = limit?.input;
	if (typeof contextLimit === "number" && typeof inputLimit === "number") {
		return Math.min(contextLimit, inputLimit);
	}
	return inputLimit ?? contextLimit ?? DEFAULT_MAX_INPUT_TOKENS;
}

function toModelInfo(modelId: string, model: ModelsDevModel): ModelInfo {
	// If context or output limits are missing, default to DEFAULT_MAX_INPUT_TOKENS and DEFAULT_MAX_TOKENS respectively.
	const maxInputTokens = resolveMaxInputTokens(model.limit);
	const outputToken = model.limit?.output ?? DEFAULT_MAX_TOKENS;
	const rawContextLimit = model.limit?.context;
	const modalities = toModalities(model.modalities);

	return {
		id: modelId,
		name: model.name || modelId,
		contextWindow: rawContextLimit,
		maxInputTokens,
		maxTokens: Math.floor(outputToken),
		capabilities: toCapabilities(modelId, model),
		reasoningOptions: model.reasoning_options,
		pricing: {
			input: model.cost?.input ?? 0,
			output: model.cost?.output ?? 0,
			cacheRead: model.cost?.cache_read ?? 0,
			cacheWrite: model.cost?.cache_write ?? 0,
		},
		status: toStatus(model.status),
		releaseDate: model.release_date,
		family: model.family,
		...(modalities !== undefined ? { modalities } : {}),
	};
}

function isDeprecatedModel(model: ModelsDevModel): boolean {
	return model.status === "deprecated";
}

export function normalizeModelsDevProviderModels(
	payload: ModelsDevPayload,
): Record<string, Record<string, ModelInfo>> {
	const providerModels: Record<string, Record<string, ModelInfo>> = {};

	for (const { source, targetProviderId } of getSelectedModelsDevProviders(
		payload,
	)) {
		if (!source?.models) {
			continue;
		}

		const models: Record<string, ModelInfo> = {};
		for (const [modelId, model] of Object.entries(source.models)) {
			const hasSupportedTranscriptionTransport =
				isDedicatedTranscriptionModel(model) &&
				TRANSCRIPTION_TRANSPORT_PROVIDER_IDS.has(targetProviderId);
			if (
				(model.tool_call !== true && !hasSupportedTranscriptionTransport) ||
				isDeprecatedModel(model)
			) {
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

function toProviderFamily(
	provider: ModelsDevProviderPayload,
): ModelsDevGeneratedProviderSpec["family"] {
	return supportedAiSdkProviderFamily(provider) ?? "openai-compatible";
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) {
		return undefined;
	}
	return trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
}

function toProviderCapabilities(
	models: Record<string, ModelInfo> | undefined,
): ModelsDevGeneratedProviderSpec["capabilities"] {
	if (!models || Object.keys(models).length === 0) {
		return undefined;
	}

	const capabilities = new Set<
		NonNullable<ModelsDevGeneratedProviderSpec["capabilities"]>[number]
	>(["tools"]);
	for (const model of Object.values(models)) {
		if (model.capabilities?.includes("reasoning")) {
			capabilities.add("reasoning");
		}
		if (model.capabilities?.includes("prompt-cache")) {
			capabilities.add("prompt-cache");
		}
	}

	return [...capabilities];
}

export function normalizeModelsDevProviderSpecs(
	payload: ModelsDevPayload,
	providerModels: Record<
		string,
		Record<string, ModelInfo>
	> = normalizeModelsDevProviderModels(payload),
): Record<string, ModelsDevGeneratedProviderSpec> {
	const providerSpecs: Record<string, ModelsDevGeneratedProviderSpec> = {};

	for (const { source, targetProviderId } of getSelectedModelsDevProviders(
		payload,
	)) {
		const baseUrl = normalizeBaseUrl(source.api);
		const models = providerModels[targetProviderId];
		const defaultModelId =
			Object.values(models ?? {}).find(isChatModel)?.id ??
			Object.keys(models ?? {})[0];
		const spec: ModelsDevGeneratedProviderSpec = {
			id: targetProviderId,
			name: source.name || targetProviderId,
			description: `${source.name || targetProviderId} model provider from models.dev`,
			family: toProviderFamily(source),
			capabilities: toProviderCapabilities(models),
			modelsProviderId: targetProviderId,
			defaultModelId,
			apiKeyEnv: source.env?.length ? [...source.env] : undefined,
			docsUrl: source.doc,
			defaults: baseUrl ? { baseUrl } : undefined,
		};
		providerSpecs[targetProviderId] = spec;
	}

	return providerSpecs;
}

async function fetchModelsDevPayload(
	url: string,
	fetcher: typeof fetch = fetch,
): Promise<ModelsDevPayload> {
	const response = await fetcher(url);
	if (!response.ok) {
		throw new Error(
			`Failed to load model catalog from ${url}: HTTP ${response.status}`,
		);
	}

	return (await response.json()) as ModelsDevPayload;
}

export async function fetchModelsDevProviderModels(
	url: string,
	fetcher: typeof fetch = fetch,
): Promise<Record<string, Record<string, ModelInfo>>> {
	return normalizeModelsDevProviderModels(
		await fetchModelsDevPayload(url, fetcher),
	);
}

export async function fetchModelsDevCatalog(
	url: string,
	fetcher: typeof fetch = fetch,
): Promise<{
	providerModels: Record<string, Record<string, ModelInfo>>;
	providerSpecs: Record<string, ModelsDevGeneratedProviderSpec>;
}> {
	const payload = await fetchModelsDevPayload(url, fetcher);
	const providerModels = normalizeModelsDevProviderModels(payload);
	return {
		providerModels,
		providerSpecs: normalizeModelsDevProviderSpecs(payload, providerModels),
	};
}

export async function fetchLiveProviderModels(
	modelsDevUrl: string,
	fetcher: typeof fetch = fetch,
): Promise<Record<string, Record<string, ModelInfo>>> {
	const emptyProviderModels: Record<string, Record<string, ModelInfo>> = {};
	const [providerModels, clineRecommendedPayload] = await Promise.all([
		fetchModelsDevProviderModels(modelsDevUrl, fetcher).catch(
			() => emptyProviderModels,
		),
		fetchClineRecommendedModelsPayload(fetcher).catch(() => undefined),
	]);
	const clineRecommended = clineRecommendedPayload
		? normalizeClineRecommendedProviderModels(
				clineRecommendedPayload,
				providerModels.openrouter ?? {},
			)
		: {};

	return {
		...providerModels,
		...clineRecommended,
	};
}

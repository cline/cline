import {
	builtinProviderSupportsModelOperation,
	normalizeBuiltinModelOperationModalities,
	resolveModelOperation,
} from "../providers/model-operations";
import {
	MODELS_DEV_BLOCKED_PROVIDER_IDS,
	MODELS_DEV_CURRENT_BUILTIN_PROVIDER_KEYS,
	resolveGeneratedProviderIdForModelsDevKey,
} from "../providers/provider-keys";
import {
	fetchClineRecommendedModelsPayload,
	normalizeClineRecommendedProviderModels,
} from "./catalog-cline-recommended";
import {
	resolveCatalogModelOperation,
	resolveCatalogModelOperationModes,
} from "./model-operation";
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

function toCapabilities(model: ModelsDevModel): ModelInfo["capabilities"] {
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

function toModalities(model: ModelsDevModel): ModelInfo["modalities"] {
	const modalities = model.modalities;
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
	let output = normalize(modalities.output);
	if (
		model.family?.trim().toLowerCase() === "gpt-image" &&
		output.includes("image")
	) {
		// models.dev has advertised some GPT Image releases as also producing
		// text. They are image-endpoint models, so keeping `text` here would route
		// them through the streaming Responses path instead of `generateImage`.
		output = output.filter((modality) => modality !== "text");
	}
	// A one-sided declaration is incomplete and must not turn an otherwise
	// usable chat model into an input- or output-incompatible model.
	if (input.length === 0 || output.length === 0) {
		return undefined;
	}
	const hasGeneratedOutput = output.some((modality) => modality !== "text");
	const isTranscriptionShape =
		input.length === 1 &&
		input[0] === "audio" &&
		output.length === 1 &&
		output[0] === "text";
	const hasAudioInput = input.includes("audio");
	// Ordinary language-model input modalities already have compact capability
	// projections (images, video, files). Audio has no generic capability flag,
	// so retain that input shape along with generated output and transcription.
	if (!hasGeneratedOutput && !isTranscriptionShape && !hasAudioInput) {
		return undefined;
	}
	return { input, output };
}

function isSpecializedOperationModel(model: ModelInfo): boolean {
	return (
		resolveModelOperation(model) !== "language" ||
		model.modalities?.output.some((modality) => modality !== "text") === true
	);
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
	const modalities = toModalities(model);
	const operation = resolveCatalogModelOperation(model);
	const operationModes = resolveCatalogModelOperationModes(modelId, model);

	return {
		id: modelId,
		name: model.name || modelId,
		contextWindow: rawContextLimit,
		maxInputTokens,
		maxTokens: Math.floor(outputToken),
		capabilities: toCapabilities(model),
		...(model.reasoning_options !== undefined
			? { reasoningOptions: model.reasoning_options }
			: {}),
		pricing: {
			input: model.cost?.input ?? 0,
			output: model.cost?.output ?? 0,
			cacheRead: model.cost?.cache_read ?? 0,
			cacheWrite: model.cost?.cache_write ?? 0,
		},
		status: toStatus(model.status),
		releaseDate: model.release_date,
		family: model.family,
		...(operation !== "language" ? { operation } : {}),
		...(operationModes ? { operationModes } : {}),
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
			const rawInfo = toModelInfo(modelId, model);
			const modalities = normalizeBuiltinModelOperationModalities({
				providerId: targetProviderId,
				modelId,
				operation: rawInfo.operation,
				operationModes: rawInfo.operationModes,
				modalities: rawInfo.modalities,
				family: rawInfo.family,
				capabilities: rawInfo.capabilities,
			});
			const info = {
				...rawInfo,
				...(modalities ? { modalities } : {}),
			};
			if (
				(model.tool_call !== true && !isSpecializedOperationModel(info)) ||
				isDeprecatedModel(model) ||
				!builtinProviderSupportsModelOperation({
					providerId: targetProviderId,
					modelId,
					operation: info.operation,
					operationModes: info.operationModes,
					modalities: info.modalities,
					family: info.family,
					capabilities: info.capabilities,
				})
			) {
				continue;
			}
			models[modelId] = info;
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

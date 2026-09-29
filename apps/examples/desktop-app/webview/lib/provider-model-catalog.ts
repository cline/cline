"use client";

import {
	isChatCompatibleModel,
	isTranscriptionModel,
} from "@cline/shared/browser";
import { desktopClient } from "@/lib/desktop-client";
import { isProviderConnected } from "@/lib/provider-connection";
import type {
	Provider,
	ProviderCatalogResponse,
	ProviderModel,
	ProviderModelsResponse,
	VoiceInputSelection,
} from "@/lib/provider-schema";

export type ProviderModelCatalog = {
	providers: Provider[];
	enabledProviderIds: string[];
	providerModels: Record<string, string[]>;
	/** Full chat-model entries per provider (display names, capabilities). */
	providerModelDetails: Record<string, ProviderModel[]>;
	/** Display name per provider id, for pickers that show providers. */
	providerNames: Record<string, string>;
	providerReasoningModels: Record<string, string[]>;
	voiceInput: TranscriptionModelTarget | null;
};

export type TranscriptionModelTarget = {
	providerId: string;
	providerName: string;
	modelId: string;
	modelName: string;
	supportsStreaming: boolean;
};

export function isDedicatedTranscriptionModel(model: ProviderModel): boolean {
	return isTranscriptionModel({
		modalities: {
			input: model.inputModalities,
			output: model.outputModalities,
		},
	});
}

/** Voice input requires continuous transcript updates, not recorded-file uploads. */
export function isStreamingTranscriptionModel(model: ProviderModel): boolean {
	return (
		isDedicatedTranscriptionModel(model) &&
		model.operationModes?.includes("streaming") === true
	);
}

export function supportsAudio(model: ProviderModel): boolean {
	return (
		model.inputModalities?.includes("audio") === true ||
		model.outputModalities?.includes("audio") === true
	);
}

export function filterChatModels(
	models: ProviderModel[] | undefined,
): ProviderModel[] {
	return (models ?? []).filter(isChatModel);
}

export function isChatModel(model: ProviderModel): boolean {
	return (
		// Desktop supports image generation directly from its composer. Other
		// chat-only clients intentionally use isChatCompatibleModel without this
		// operation-specific exception.
		model.operation === "image-generation" ||
		isChatCompatibleModel({
			operation: model.operation,
			modalities: {
				input: model.inputModalities,
				output: model.outputModalities,
			},
		})
	);
}

export function selectTranscriptionModel(
	providers: Provider[],
	selection: VoiceInputSelection | undefined,
): TranscriptionModelTarget | null {
	if (!selection) return null;
	const provider = providers.find(
		(candidate) => candidate.enabled && candidate.id === selection.providerId,
	);
	const model = provider?.modelList?.find(
		(candidate) =>
			candidate.id === selection.modelId &&
			isStreamingTranscriptionModel(candidate),
	);
	return provider && model
		? {
				providerId: provider.id,
				providerName: provider.name,
				modelId: model.id,
				modelName: model.name,
				supportsStreaming: model.operationModes?.includes("streaming") === true,
			}
		: null;
}

export function buildProviderModelCatalog(
	providers: Provider[],
	voiceInput?: VoiceInputSelection,
): ProviderModelCatalog {
	const providerEntries = providers.map((provider) => {
		const chatModels = filterChatModels(provider.modelList);
		return {
			provider,
			chatModels,
			modelIds: chatModels.map((model) => model.id),
			reasoningModelIds: chatModels
				.filter((model) => model.supportsReasoning)
				.map((model) => model.id),
		};
	});

	return {
		providers,
		enabledProviderIds: providerEntries
			.filter(
				({ provider, modelIds }) => provider.enabled && modelIds.length > 0,
			)
			.map(({ provider }) => provider.id),
		providerModels: Object.fromEntries(
			providerEntries.map(({ provider, modelIds }) => [provider.id, modelIds]),
		),
		providerModelDetails: Object.fromEntries(
			providerEntries.map(({ provider, chatModels }) => [
				provider.id,
				chatModels,
			]),
		),
		providerNames: Object.fromEntries(
			providers.map((provider) => [provider.id, provider.name]),
		),
		providerReasoningModels: Object.fromEntries(
			providerEntries.map(({ provider, reasoningModelIds }) => [
				provider.id,
				reasoningModelIds,
			]),
		),
		voiceInput: selectTranscriptionModel(providers, voiceInput),
	};
}

// The provider catalog payload is large (hundreds of KB) and several
// components request it at startup (composer, onboarding, credentials sync).
// Deduplicate concurrent requests and keep the response briefly so the app
// boot issues a single round-trip instead of one per consumer.
const PROVIDER_CATALOG_CACHE_TTL_MS = 5_000;
export const VOICE_INPUT_SETTINGS_CHANGED_EVENT =
	"cline:voice-input-settings-changed";

let providerCatalogCache: {
	fetchedAt: number;
	promise: Promise<ProviderCatalogResponse>;
} | null = null;
let providerCatalogPayload: ProviderCatalogResponse | null = null;

// Discovery can contact provider APIs. Reuse verified results across settings
// and chat remounts; execution still validates against the provider catalog.
const TRANSCRIPTION_MODELS_CACHE_TTL_MS = 5 * 60_000;
const transcriptionModelsCache = new Map<
	string,
	{
		fetchedAt: number;
		promise: Promise<ProviderModel[]>;
		models?: ProviderModel[];
	}
>();

export function readVoiceInputCatalog(): ProviderCatalogResponse | null {
	if (!providerCatalogPayload) return null;
	const providers: Provider[] = [];
	for (const provider of providerCatalogPayload.providers ?? []) {
		if (!isProviderConnected(provider)) {
			providers.push(provider);
			continue;
		}
		const cached = transcriptionModelsCache.get(provider.id);
		if (
			!cached?.models ||
			Date.now() - cached.fetchedAt >= TRANSCRIPTION_MODELS_CACHE_TTL_MS
		)
			return null;
		providers.push({ ...provider, modelList: cached.models });
	}
	return { ...providerCatalogPayload, providers };
}

type ProviderModelsListener = (
	providerId: string,
	models: ProviderModel[],
) => void;
const providerModelsListeners = new Set<ProviderModelsListener>();

export function publishProviderModels(
	providerId: string,
	models: ProviderModel[],
): void {
	invalidateProviderCatalogCache();
	const chatModels = filterChatModels(models);
	for (const listener of providerModelsListeners) {
		listener(providerId, chatModels);
	}
}

export function subscribeToProviderModels(
	listener: ProviderModelsListener,
): () => void {
	providerModelsListeners.add(listener);
	return () => providerModelsListeners.delete(listener);
}

export function fetchProviderCatalog(options?: {
	fresh?: boolean;
}): Promise<ProviderCatalogResponse> {
	const now = Date.now();
	if (
		!options?.fresh &&
		providerCatalogCache &&
		now - providerCatalogCache.fetchedAt < PROVIDER_CATALOG_CACHE_TTL_MS
	) {
		return providerCatalogCache.promise;
	}
	const promise = desktopClient
		.invoke<ProviderCatalogResponse>("list_provider_catalog")
		.then((payload) => {
			if (providerCatalogCache?.promise === promise)
				providerCatalogPayload = payload;
			return payload;
		})
		.catch((error) => {
			// Never cache failures.
			if (providerCatalogCache?.promise === promise) {
				providerCatalogCache = null;
			}
			throw error;
		});
	providerCatalogCache = { fetchedAt: now, promise };
	return promise;
}

type ProviderCatalogInvalidationListener = () => void;
const providerCatalogInvalidationListeners =
	new Set<ProviderCatalogInvalidationListener>();

/**
 * Notifies when the provider catalog cache is invalidated (credentials
 * saved, providers toggled, OAuth completed) so long-lived consumers — e.g.
 * the chat pane's "connect a model" notice — can refetch instead of showing
 * stale connection state until they happen to remount.
 */
export function subscribeToProviderCatalogInvalidation(
	listener: ProviderCatalogInvalidationListener,
): () => void {
	providerCatalogInvalidationListeners.add(listener);
	return () => providerCatalogInvalidationListeners.delete(listener);
}

export function invalidateProviderCatalogCache(): void {
	providerCatalogCache = null;
	providerCatalogPayload = null;
	transcriptionModelsCache.clear();
	// Credentials may have just changed: a pane remounting off the snapshot
	// must not act on the old keys, so drop it until a fresh load lands.
	providerCatalogSnapshot = null;
	for (const listener of providerCatalogInvalidationListeners) {
		listener();
	}
}

// "+ new chat" remounts the chat pane, which otherwise blocks its first
// paint on a full catalog fetch. The last successful load is kept here (not
// in the pane module) so credential changes invalidate it with the cache.
export type ProviderCatalogSnapshot = {
	credentials: Record<string, { apiKey: string }>;
	contextWindows: Record<string, Record<string, number>>;
};

let providerCatalogSnapshot: ProviderCatalogSnapshot | null = null;

export function readProviderCatalogSnapshot(): ProviderCatalogSnapshot | null {
	return providerCatalogSnapshot;
}

export function writeProviderCatalogSnapshot(
	snapshot: ProviderCatalogSnapshot,
): void {
	providerCatalogSnapshot = snapshot;
}

export function notifyVoiceInputSettingsChanged(settings?: {
	voiceInput?: VoiceInputSelection;
}): void {
	if (settings && providerCatalogPayload) {
		// A model selection does not change credentials or provider capabilities.
		providerCatalogPayload = {
			...providerCatalogPayload,
			voiceInput: settings.voiceInput,
		};
		providerCatalogCache = {
			fetchedAt: Date.now(),
			promise: Promise.resolve(providerCatalogPayload),
		};
	} else {
		invalidateProviderCatalogCache();
	}
	if (typeof window !== "undefined") {
		window.dispatchEvent(new Event(VOICE_INPUT_SETTINGS_CHANGED_EVENT));
	}
}

export async function loadProviderModelCatalog(options?: {
	includeVoiceInput?: boolean;
}): Promise<ProviderModelCatalog> {
	const payload = await fetchProviderCatalog();
	const catalog = buildProviderModelCatalog(payload.providers ?? []);
	// Voice discovery may need the provider network. Chat and routine pickers
	// should remain usable even if the configured voice provider is unavailable.
	if (!options?.includeVoiceInput) return catalog;
	const selection = payload.voiceInput;
	const provider = catalog.providers.find(
		(entry) => entry.id === selection?.providerId && isProviderConnected(entry),
	);
	if (selection && provider) {
		const models = await loadTranscriptionModels(provider.id);
		catalog.voiceInput = selectTranscriptionModel(
			[{ ...provider, modelList: models }],
			selection,
		);
	}
	return catalog;
}

export function loadTranscriptionModels(
	providerId: string,
): Promise<ProviderModel[]> {
	const cached = transcriptionModelsCache.get(providerId);
	if (
		cached &&
		Date.now() - cached.fetchedAt < TRANSCRIPTION_MODELS_CACHE_TTL_MS
	)
		return cached.promise;
	const promise = desktopClient
		.invoke<ProviderModelsResponse>("list_transcription_models", {
			provider: providerId,
		})
		.then((payload) => {
			const models = payload.models.filter(isDedicatedTranscriptionModel);
			const entry = transcriptionModelsCache.get(providerId);
			if (entry?.promise === promise) {
				entry.models = models;
				entry.fetchedAt = Date.now();
			}
			return models;
		})
		.catch((error) => {
			if (transcriptionModelsCache.get(providerId)?.promise === promise)
				transcriptionModelsCache.delete(providerId);
			throw error;
		});
	transcriptionModelsCache.set(providerId, { fetchedAt: Date.now(), promise });
	return promise;
}

export async function loadProviderModels(
	providerId: string,
	options?: { includeCloudModels?: boolean },
): Promise<ProviderModel[]> {
	const payload = await desktopClient.invoke<ProviderModelsResponse>(
		"list_provider_models",
		{
			provider: providerId,
			...(options?.includeCloudModels ? { includeCloudModels: true } : {}),
		},
	);
	return filterChatModels(payload.models);
}

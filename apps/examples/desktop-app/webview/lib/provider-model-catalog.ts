"use client";

import { isChatCompatibleModel } from "@cline/shared/browser";
import { desktopClient } from "@/lib/desktop-client";
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
	return model.operation === "transcription";
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
			isDedicatedTranscriptionModel(candidate),
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

function toModelIds(models: ProviderModel[] | undefined): string[] {
	return filterChatModels(models).map((model) => model.id);
}

function toReasoningModelIds(models: ProviderModel[] | undefined): string[] {
	return filterChatModels(models)
		.filter((model) => model.supportsReasoning)
		.map((model) => model.id);
}

export function buildProviderModelCatalog(
	providers: Provider[],
	voiceInput?: VoiceInputSelection,
): ProviderModelCatalog {
	return {
		providers,
		enabledProviderIds: providers
			.filter(
				(provider) =>
					provider.enabled && toModelIds(provider.modelList).length > 0,
			)
			.map((provider) => provider.id),
		providerModels: Object.fromEntries(
			providers.map((provider) => [
				provider.id,
				toModelIds(provider.modelList),
			]),
		),
		providerReasoningModels: Object.fromEntries(
			providers.map((provider) => [
				provider.id,
				toReasoningModelIds(provider.modelList),
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

export function notifyVoiceInputSettingsChanged(): void {
	invalidateProviderCatalogCache();
	if (typeof window !== "undefined") {
		window.dispatchEvent(new Event(VOICE_INPUT_SETTINGS_CHANGED_EVENT));
	}
}

export async function loadProviderModelCatalog(): Promise<ProviderModelCatalog> {
	const payload = await fetchProviderCatalog();
	return buildProviderModelCatalog(payload.providers ?? [], payload.voiceInput);
}

export async function loadProviderModels(
	providerId: string,
): Promise<ProviderModel[]> {
	const payload = await desktopClient.invoke<ProviderModelsResponse>(
		"list_provider_models",
		{
			provider: providerId,
		},
	);
	return filterChatModels(payload.models);
}

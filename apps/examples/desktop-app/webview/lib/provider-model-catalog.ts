"use client";

import { desktopClient } from "@/lib/desktop-client";
import type {
	Provider,
	ProviderCatalogResponse,
	ProviderModel,
	ProviderModelsResponse,
} from "@/lib/provider-schema";

export type ProviderModelCatalog = {
	providers: Provider[];
	enabledProviderIds: string[];
	providerModels: Record<string, string[]>;
	providerReasoningModels: Record<string, string[]>;
};

function toModelIds(models: ProviderModel[] | undefined): string[] {
	return (models ?? []).map((model) => model.id);
}

function toReasoningModelIds(models: ProviderModel[] | undefined): string[] {
	return (models ?? [])
		.filter((model) => model.supportsReasoning)
		.map((model) => model.id);
}

export function buildProviderModelCatalog(
	providers: Provider[],
): ProviderModelCatalog {
	return {
		providers,
		enabledProviderIds: providers
			.filter((provider) => provider.enabled)
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
	};
}

// The provider catalog payload is large (hundreds of KB) and several
// components request it at startup (composer, onboarding, credentials sync).
// Deduplicate concurrent requests and keep the response briefly so the app
// boot issues a single round-trip instead of one per consumer.
const PROVIDER_CATALOG_CACHE_TTL_MS = 5_000;

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
	for (const listener of providerModelsListeners) {
		listener(providerId, models);
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

export async function loadProviderModelCatalog(): Promise<ProviderModelCatalog> {
	const payload = await fetchProviderCatalog();
	return buildProviderModelCatalog(payload.providers ?? []);
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
	return payload.models ?? [];
}

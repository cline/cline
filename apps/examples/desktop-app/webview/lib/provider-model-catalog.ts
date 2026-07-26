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

export function invalidateProviderCatalogCache(): void {
	providerCatalogCache = null;
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

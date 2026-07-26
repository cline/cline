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

const PROVIDER_CATALOG_CACHE_TTL_MS = 60_000;
let providerCatalogCache: {
	catalog: ProviderModelCatalog;
	fetchedAt: number;
} | null = null;
let providerCatalogRequest: Promise<ProviderModelCatalog> | null = null;

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

export function primeProviderModelCatalog(providers: Provider[]): void {
	providerCatalogCache = {
		catalog: buildProviderModelCatalog(providers),
		fetchedAt: Date.now(),
	};
}

export function clearProviderModelCatalogCache(): void {
	providerCatalogCache = null;
	providerCatalogRequest = null;
}

export async function loadProviderModelCatalog(options?: {
	force?: boolean;
}): Promise<ProviderModelCatalog> {
	if (
		!options?.force &&
		providerCatalogCache &&
		Date.now() - providerCatalogCache.fetchedAt < PROVIDER_CATALOG_CACHE_TTL_MS
	) {
		return providerCatalogCache.catalog;
	}
	if (!options?.force && providerCatalogRequest) {
		return await providerCatalogRequest;
	}

	const request = desktopClient
		.invoke<ProviderCatalogResponse>("list_provider_catalog")
		.then((payload) => {
			const catalog = buildProviderModelCatalog(payload.providers ?? []);
			providerCatalogCache = { catalog, fetchedAt: Date.now() };
			return catalog;
		})
		.finally(() => {
			if (providerCatalogRequest === request) {
				providerCatalogRequest = null;
			}
		});
	providerCatalogRequest = request;
	return await request;
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

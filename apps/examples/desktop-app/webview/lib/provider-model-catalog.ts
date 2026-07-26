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

/**
 * The catalog is ~700KB of JSON — every provider Cline knows about, each with
 * its full model list. Four unrelated call sites want it (chat composer,
 * onboarding, settings, routines) and several of them mount at once, so
 * without a shared cache a single cold start used to ship it over the
 * transport ten times.
 *
 * The payload carries live credential and enabled state, so anything that
 * mutates provider settings must call `invalidateProviderCatalog`.
 */
const PROVIDER_CATALOG_TTL_MS = 60_000;

let catalogCache: { providers: Provider[]; fetchedAt: number } | null = null;
let catalogInFlight: Promise<Provider[]> | null = null;

export function readCachedProviderCatalog(): Provider[] | null {
	if (!catalogCache) return null;
	if (Date.now() - catalogCache.fetchedAt > PROVIDER_CATALOG_TTL_MS)
		return null;
	return catalogCache.providers;
}

/** Replaces the cache after a local edit, so the next reader sees it. */
export function writeProviderCatalogCache(providers: Provider[]): void {
	catalogCache = { providers, fetchedAt: Date.now() };
}

export function invalidateProviderCatalog(): void {
	catalogCache = null;
}

export async function loadProviderCatalog(
	options: { force?: boolean } = {},
): Promise<Provider[]> {
	if (!options.force) {
		const cached = readCachedProviderCatalog();
		if (cached) return cached;
		if (catalogInFlight) return catalogInFlight;
	}

	catalogInFlight = (async () => {
		const payload = await desktopClient.invoke<ProviderCatalogResponse>(
			"list_provider_catalog",
		);
		const providers = payload.providers ?? [];
		writeProviderCatalogCache(providers);
		return providers;
	})().finally(() => {
		catalogInFlight = null;
	});

	return catalogInFlight;
}

export async function loadProviderModelCatalog(): Promise<ProviderModelCatalog> {
	return buildProviderModelCatalog(await loadProviderCatalog());
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

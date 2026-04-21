import { GENERATED_PROVIDER_MODELS } from "./catalog.generated";
import { sortModelsByReleaseDate } from "./catalog-live";
import type { ModelInfo } from "./types";

let sortedGeneratedProviderModelsCache:
	| Record<string, Record<string, ModelInfo>>
	| undefined;
const sortedGeneratedModelsByProviderCache = new Map<
	string,
	Record<string, ModelInfo>
>();

export function getGeneratedProviderModels(): Record<
	string,
	Record<string, ModelInfo>
> {
	sortedGeneratedProviderModelsCache ??= Object.fromEntries(
		Object.entries(GENERATED_PROVIDER_MODELS.providers).map(
			([providerId, models]) => [providerId, sortModelsByReleaseDate(models)],
		),
	);
	return sortedGeneratedProviderModelsCache;
}

export function getGeneratedModelsVersion(): number {
	return GENERATED_PROVIDER_MODELS.version;
}

export function getGeneratedModelsForProvider(
	providerId: string,
): Record<string, ModelInfo> {
	const cached = sortedGeneratedModelsByProviderCache.get(providerId);
	if (cached) {
		return cached;
	}
	const sorted = sortModelsByReleaseDate(
		GENERATED_PROVIDER_MODELS.providers[providerId] ?? {},
	);
	sortedGeneratedModelsByProviderCache.set(providerId, sorted);
	return sorted;
}

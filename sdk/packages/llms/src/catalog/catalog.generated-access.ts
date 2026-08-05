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

const DIRECT_MINIMAX_PROVIDERS = new Set([
	"minimax",
	"minimax-cn",
	"minimax-coding-plan",
	"minimax-cn-coding-plan",
]);

function applyGeneratedCatalogCorrections(
	providerId: string,
	models: Record<string, ModelInfo>,
): Record<string, ModelInfo> {
	if (!DIRECT_MINIMAX_PROVIDERS.has(providerId)) return models;
	const miniMaxM3 = models["MiniMax-M3"];
	if (!miniMaxM3) return models;
	const capabilities = [
		...new Set<NonNullable<ModelInfo["capabilities"]>[number]>([
			...(miniMaxM3.capabilities ?? []),
			"images",
			"video",
		]),
	];
	return {
		...models,
		"MiniMax-M3": {
			...miniMaxM3,
			capabilities,
		},
	};
}

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
		applyGeneratedCatalogCorrections(
			providerId,
			GENERATED_PROVIDER_MODELS.providers[providerId] ?? {},
		),
	);
	sortedGeneratedModelsByProviderCache.set(providerId, sorted);
	return sorted;
}

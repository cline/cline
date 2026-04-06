import { MODEL_COLLECTIONS_BY_PROVIDER_ID } from "./provider-catalog";
import type { ModelCollection, ModelInfo, ProviderInfo } from "./types";

const PROVIDER_CACHE: Map<string, ModelCollection> = new Map(
	Object.entries(MODEL_COLLECTIONS_BY_PROVIDER_ID),
);

const CUSTOM_MODELS: Map<string, Map<string, ModelInfo>> = new Map();
const CUSTOM_PROVIDERS: Map<string, ModelCollection> = new Map();

function getProviderFromCache(providerId: string): ModelCollection | undefined {
	return CUSTOM_PROVIDERS.get(providerId) ?? PROVIDER_CACHE.get(providerId);
}

async function getOrLoadProvider(
	providerId: string,
): Promise<ModelCollection | undefined> {
	return getProviderFromCache(providerId);
}

export function getProviderIds(): string[] {
	const builtInIds = Array.from(PROVIDER_CACHE.keys());
	const customIds = Array.from(CUSTOM_PROVIDERS.keys()).filter(
		(id) => !PROVIDER_CACHE.has(id),
	);
	return [...builtInIds, ...customIds];
}

export function hasProvider(providerId: string): boolean {
	return PROVIDER_CACHE.has(providerId) || CUSTOM_PROVIDERS.has(providerId);
}

export async function getProvider(
	providerId: string,
): Promise<ProviderInfo | undefined> {
	const collection = await getOrLoadProvider(providerId);
	return collection?.provider;
}

export async function getProviderCollection(
	providerId: string,
): Promise<ModelCollection | undefined> {
	return getOrLoadProvider(providerId);
}

export async function getAllProviders(): Promise<ProviderInfo[]> {
	return getProviderIds()
		.map((providerId) => getProviderFromCache(providerId)?.provider)
		.filter((provider): provider is ProviderInfo => provider !== undefined);
}

export async function getModelsForProvider(
	providerId: string,
): Promise<Record<string, ModelInfo>> {
	const collection = await getOrLoadProvider(providerId);
	const builtInModels = collection?.models ?? {};
	const customModels = CUSTOM_MODELS.get(providerId);

	if (customModels) {
		return { ...builtInModels, ...Object.fromEntries(customModels) };
	}

	return builtInModels;
}

export function registerProvider(collection: ModelCollection): void {
	CUSTOM_PROVIDERS.set(collection.provider.id, collection);
}

export function registerModel(
	providerId: string,
	modelId: string,
	info: ModelInfo,
): void {
	if (!CUSTOM_MODELS.has(providerId)) {
		CUSTOM_MODELS.set(providerId, new Map());
	}
	CUSTOM_MODELS.get(providerId)?.set(modelId, { ...info, id: modelId });
}

export function unregisterProvider(providerId: string): boolean {
	CUSTOM_MODELS.delete(providerId);
	return CUSTOM_PROVIDERS.delete(providerId);
}

export function resetRegistry(): void {
	CUSTOM_MODELS.clear();
	CUSTOM_PROVIDERS.clear();
}

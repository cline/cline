import type { ModelCollection, ModelInfo, ProviderInfo } from "../model/types";
import { BUILTIN_PROVIDER_COLLECTION_LIST } from "./builtins";

function buildInitialRegistry(): Map<string, ModelCollection> {
	const map = new Map<string, ModelCollection>();
	for (const collection of BUILTIN_PROVIDER_COLLECTION_LIST) {
		map.set(collection.provider.id, {
			provider: { ...collection.provider },
			models: Object.fromEntries(
				Object.entries(collection.models).map(([id, model]) => [
					id,
					{ ...model },
				]),
			),
		});
	}
	return map;
}

const PROVIDER_CACHE: Map<string, ModelCollection> = buildInitialRegistry();
const CUSTOM_MODELS: Map<string, Map<string, ModelInfo>> = new Map();
const CUSTOM_PROVIDERS: Map<string, ModelCollection> = new Map();

function getProviderFromCache(providerId: string): ModelCollection | undefined {
	return CUSTOM_PROVIDERS.get(providerId) ?? PROVIDER_CACHE.get(providerId);
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
	return getProviderFromCache(providerId)?.provider;
}

export function getProviderCollectionSync(
	providerId: string,
): ModelCollection | undefined {
	return getProviderFromCache(providerId);
}

export async function getProviderCollection(
	providerId: string,
): Promise<ModelCollection | undefined> {
	return getProviderFromCache(providerId);
}

export async function getModelsForProvider(
	providerId: string,
): Promise<Record<string, ModelInfo>> {
	const collection = getProviderFromCache(providerId);
	const builtInModels = collection?.models ?? {};
	const customModels = CUSTOM_MODELS.get(providerId);
	if (customModels) {
		return { ...builtInModels, ...Object.fromEntries(customModels) };
	}
	return builtInModels;
}

export async function getAllProviders(): Promise<ProviderInfo[]> {
	return getProviderIds()
		.map((id) => getProviderFromCache(id)?.provider)
		.filter((p): p is ProviderInfo => p !== undefined);
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

// MODEL_COLLECTIONS_BY_PROVIDER_ID: live view merging custom providers over builtins
export const MODEL_COLLECTIONS_BY_PROVIDER_ID: Record<string, ModelCollection> =
	new Proxy({} as Record<string, ModelCollection>, {
		get(_target, key: string) {
			return getProviderFromCache(key);
		},
		has(_target, key: string) {
			return PROVIDER_CACHE.has(key) || CUSTOM_PROVIDERS.has(key);
		},
		ownKeys() {
			return getProviderIds();
		},
		getOwnPropertyDescriptor(_target, key: string) {
			const val = getProviderFromCache(key as string);
			if (val === undefined) return undefined;
			return { configurable: true, enumerable: true, value: val };
		},
	});

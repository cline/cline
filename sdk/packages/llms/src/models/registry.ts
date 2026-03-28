/**
 * Model Registry
 *
 * Central registry for all model definitions across providers.
 * Provides methods to access, query, and manage models.
 *
 * Uses lazy loading - providers are only loaded when first accessed.
 */
import { GENERATED_PROVIDER_LOADER_ENTRIES } from "./generated-provider-loaders";
import type { ModelCollection, ModelInfo, ProviderInfo } from "./types/index";

// =============================================================================
// Types
// =============================================================================

interface ProviderLoaderConfig {
	load: () => Promise<ModelCollection>;
}

type ProviderLoaderEntry = readonly [
	providerId: string,
	load: () => Promise<ModelCollection>,
];

// =============================================================================
// Registry Storage
// =============================================================================

/**
 * Loaded provider collections (cache)
 */
const PROVIDER_CACHE: Map<string, ModelCollection> = new Map();

/**
 * Provider loader configurations - maps provider ID to how to load it
 */
const PROVIDER_LOADERS: Map<string, ProviderLoaderConfig> = new Map();

/**
 * Custom models added at runtime
 */
const CUSTOM_MODELS: Map<string, Map<string, ModelInfo>> = new Map();

/**
 * Custom providers registered at runtime (not lazy loaded)
 */
const CUSTOM_PROVIDERS: Map<string, ModelCollection> = new Map();

// =============================================================================
// Provider Loader Registration
// =============================================================================

/**
 * Register built-in provider loaders (does not load the providers)
 *
 * Generated from provider module metadata at build time.
 */
const BUILT_IN_PROVIDER_LOADER_ENTRIES: ProviderLoaderEntry[] =
	GENERATED_PROVIDER_LOADER_ENTRIES;

function registerBuiltInProviderLoaders(): void {
	for (const [providerId, load] of BUILT_IN_PROVIDER_LOADER_ENTRIES) {
		PROVIDER_LOADERS.set(providerId, { load });
	}
}

// Initialize loaders on module load (but not the actual providers)
registerBuiltInProviderLoaders();

// =============================================================================
// Lazy Loading
// =============================================================================

/**
 * Dynamically load a provider module
 */
async function loadProviderModule(
	config: ProviderLoaderConfig,
): Promise<ModelCollection> {
	return config.load();
}

/**
 * Get or load a provider collection (async)
 */
async function getOrLoadProvider(
	providerId: string,
): Promise<ModelCollection | undefined> {
	// Check custom providers first
	if (CUSTOM_PROVIDERS.has(providerId)) {
		return CUSTOM_PROVIDERS.get(providerId);
	}

	// Check cache
	if (PROVIDER_CACHE.has(providerId)) {
		return PROVIDER_CACHE.get(providerId);
	}

	// Check if we have a loader
	const config = PROVIDER_LOADERS.get(providerId);
	if (!config) {
		return undefined;
	}

	// Load and cache
	const collection = await loadProviderModule(config);
	PROVIDER_CACHE.set(providerId, collection);
	return collection;
}

/**
 * Get provider from cache only (sync) - returns undefined if not loaded
 */
function getProviderFromCache(providerId: string): ModelCollection | undefined {
	return CUSTOM_PROVIDERS.get(providerId) ?? PROVIDER_CACHE.get(providerId);
}

// =============================================================================
// Provider Access
// =============================================================================

/**
 * Get all registered provider IDs (does not load providers)
 */
export function getProviderIds(): string[] {
	const builtInIds = Array.from(PROVIDER_LOADERS.keys());
	const customIds = Array.from(CUSTOM_PROVIDERS.keys()).filter(
		(id) => !PROVIDER_LOADERS.has(id),
	);
	return [...builtInIds, ...customIds];
}

/**
 * Check if a provider is registered (does not load it)
 */
export function hasProvider(providerId: string): boolean {
	return PROVIDER_LOADERS.has(providerId) || CUSTOM_PROVIDERS.has(providerId);
}

/**
 * Get provider by ID (async - loads if needed)
 */
export async function getProvider(
	providerId: string,
): Promise<ProviderInfo | undefined> {
	const collection = await getOrLoadProvider(providerId);
	return collection?.provider;
}

/**
 * Get provider collection by ID (async - loads if needed)
 */
export async function getProviderCollection(
	providerId: string,
): Promise<ModelCollection | undefined> {
	return getOrLoadProvider(providerId);
}

/**
 * Get all providers (async - loads all providers)
 */
export async function getAllProviders(): Promise<ProviderInfo[]> {
	const ids = getProviderIds();
	const collections = await Promise.all(ids.map((id) => getOrLoadProvider(id)));
	return collections
		.filter((c): c is ModelCollection => c !== undefined)
		.map((c) => c.provider);
}

/**
 * Preload specific providers into cache
 */
export async function preloadProviders(providerIds: string[]): Promise<void> {
	await Promise.all(providerIds.map((id) => getOrLoadProvider(id)));
}

/**
 * Preload all providers into cache
 */
export async function preloadAllProviders(): Promise<void> {
	await preloadProviders(getProviderIds());
}

// =============================================================================
// Sync Access (for already-loaded providers)
// =============================================================================

/**
 * Get provider from cache (sync) - returns undefined if not loaded yet
 * Use this when you know the provider has been preloaded
 */
export function getProviderSync(providerId: string): ProviderInfo | undefined {
	return getProviderFromCache(providerId)?.provider;
}

/**
 * Get provider collection from cache (sync) - returns undefined if not loaded yet
 * Use this when you know the provider has been preloaded
 */
export function getProviderCollectionSync(
	providerId: string,
): ModelCollection | undefined {
	return getProviderFromCache(providerId);
}

/**
 * Get all loaded providers (sync) - only returns already-loaded providers
 */
export function getLoadedProviders(): ProviderInfo[] {
	const loaded: ProviderInfo[] = [];
	for (const collection of PROVIDER_CACHE.values()) {
		loaded.push(collection.provider);
	}
	for (const collection of CUSTOM_PROVIDERS.values()) {
		loaded.push(collection.provider);
	}
	return loaded;
}

/**
 * Check if a provider is loaded in cache
 */
export function isProviderLoaded(providerId: string): boolean {
	return PROVIDER_CACHE.has(providerId) || CUSTOM_PROVIDERS.has(providerId);
}

// =============================================================================
// Model Access
// =============================================================================

/**
 * Get all models for a provider (async - loads provider if needed)
 */
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

/**
 * Get a specific model by provider and model ID (async)
 */
export async function getModel(
	providerId: string,
	modelId: string,
): Promise<ModelInfo | undefined> {
	// Check custom models first
	const customModels = CUSTOM_MODELS.get(providerId);
	if (customModels?.has(modelId)) {
		return customModels.get(modelId);
	}

	// Fall back to built-in models
	const collection = await getOrLoadProvider(providerId);
	return collection?.models[modelId];
}

/**
 * Get the default model for a provider (async)
 */
export async function getDefaultModel(
	providerId: string,
): Promise<{ id: string; info: ModelInfo } | undefined> {
	const collection = await getOrLoadProvider(providerId);
	if (!collection) {
		return undefined;
	}

	const defaultId = collection.provider.defaultModelId;
	const info = await getModel(providerId, defaultId);

	if (!info) {
		return undefined;
	}

	return { id: defaultId, info };
}

/**
 * Get all models across all providers (async - loads all providers)
 */
export async function getAllModels(): Promise<
	Array<{ providerId: string; modelId: string; info: ModelInfo }>
> {
	const result: Array<{
		providerId: string;
		modelId: string;
		info: ModelInfo;
	}> = [];
	const providerIds = getProviderIds();

	await Promise.all(
		providerIds.map(async (providerId) => {
			const collection = await getOrLoadProvider(providerId);
			if (!collection) return;

			// Add built-in models
			for (const [modelId, info] of Object.entries(collection.models)) {
				result.push({ providerId, modelId, info });
			}

			// Add custom models
			const customModels = CUSTOM_MODELS.get(providerId);
			if (customModels) {
				for (const [modelId, info] of customModels) {
					// Skip if already added from built-in (custom overrides built-in)
					if (!collection.models[modelId]) {
						result.push({ providerId, modelId, info });
					}
				}
			}
		}),
	);

	return result;
}

/**
 * Get total count of registered models (async - loads all providers)
 */
export async function getModelCount(): Promise<number> {
	let count = 0;
	const providerIds = getProviderIds();

	await Promise.all(
		providerIds.map(async (providerId) => {
			const collection = await getOrLoadProvider(providerId);
			if (!collection) return;

			count += Object.keys(collection.models).length;

			const customModels = CUSTOM_MODELS.get(providerId);
			if (customModels) {
				// Only count custom models not already in built-in
				for (const modelId of customModels.keys()) {
					if (!collection.models[modelId]) {
						count++;
					}
				}
			}
		}),
	);

	return count;
}

// =============================================================================
// Sync Model Access (for already-loaded providers)
// =============================================================================

/**
 * Get models for an already-loaded provider (sync)
 * Returns empty object if provider is not loaded
 */
export function getModelsForProviderSync(
	providerId: string,
): Record<string, ModelInfo> {
	const collection = getProviderFromCache(providerId);
	const builtInModels = collection?.models ?? {};
	const customModels = CUSTOM_MODELS.get(providerId);

	if (customModels) {
		return { ...builtInModels, ...Object.fromEntries(customModels) };
	}

	return builtInModels;
}

/**
 * Get a specific model from an already-loaded provider (sync)
 */
export function getModelSync(
	providerId: string,
	modelId: string,
): ModelInfo | undefined {
	// Check custom models first
	const customModels = CUSTOM_MODELS.get(providerId);
	if (customModels?.has(modelId)) {
		return customModels.get(modelId);
	}

	// Fall back to built-in models
	const collection = getProviderFromCache(providerId);
	return collection?.models[modelId];
}

// =============================================================================
// Custom Model Management
// =============================================================================

/**
 * Register a custom provider (immediately available, not lazy loaded)
 */
export function registerProvider(collection: ModelCollection): void {
	CUSTOM_PROVIDERS.set(collection.provider.id, collection);
}

/**
 * Register a custom model for a provider
 */
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

/**
 * Unregister a custom model
 */
export function unregisterModel(providerId: string, modelId: string): boolean {
	const customModels = CUSTOM_MODELS.get(providerId);
	if (customModels) {
		return customModels.delete(modelId);
	}
	return false;
}

/**
 * Unregister a provider
 */
export function unregisterProvider(providerId: string): boolean {
	CUSTOM_MODELS.delete(providerId);
	PROVIDER_CACHE.delete(providerId);
	return (
		CUSTOM_PROVIDERS.delete(providerId) || PROVIDER_LOADERS.delete(providerId)
	);
}

/**
 * Clear all custom models (keeps built-in)
 */
export function clearCustomModels(): void {
	CUSTOM_MODELS.clear();
}

/**
 * Reset registry to initial state (clears cache, keeps loaders)
 */
export function resetRegistry(): void {
	PROVIDER_CACHE.clear();
	CUSTOM_MODELS.clear();
	CUSTOM_PROVIDERS.clear();
}

// =============================================================================
// Batch Operations
// =============================================================================

/**
 * Register multiple models at once
 */
export function registerModels(
	providerId: string,
	models: Record<string, ModelInfo>,
): void {
	for (const [modelId, info] of Object.entries(models)) {
		registerModel(providerId, modelId, info);
	}
}

/**
 * Update model info (merges with existing) - async
 */
export async function updateModel(
	providerId: string,
	modelId: string,
	updates: Partial<ModelInfo>,
): Promise<ModelInfo | undefined> {
	const existing = await getModel(providerId, modelId);
	if (!existing) {
		return undefined;
	}

	const updated: ModelInfo = { ...existing, ...updates };
	registerModel(providerId, modelId, updated);

	return updated;
}

/**
 * Mark a model as deprecated - async
 */
export async function deprecateModel(
	providerId: string,
	modelId: string,
	options?: {
		notice?: string;
		replacedBy?: string;
		deprecationDate?: string;
	},
): Promise<ModelInfo | undefined> {
	return updateModel(providerId, modelId, {
		status: "deprecated",
		deprecationNotice: options?.notice,
		replacedBy: options?.replacedBy,
		deprecationDate: options?.deprecationDate,
	});
}

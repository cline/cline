import { listLocalProviders, type ModelCatalogConfig, resolveProviderConfig } from "@cline/core"
import { type ProviderConfig, resolveProviderUsageCostDisplay } from "@cline/llms"
import { type ProviderListItem } from "@cline/shared"
import { getFeatureFlagsService } from "@/services/feature-flags"
import { FeatureFlag } from "@/shared/services/feature-flags/feature-flags"
import { getProviderSettingsManager } from "../provider-migration"
import type {
	CatalogError,
	Disposable,
	EffectiveProviderConfig,
	Fingerprint,
	ModelSelection,
	ProviderCatalog,
	ProviderConfigReader,
	ProviderId,
	ProviderListing,
	ProviderModelsEvent,
	ProviderModelsResult,
	UsageCostDisplay,
} from "./contracts"
import { providerAllowsCustomModelIds } from "./custom-model-ids"
import { computeConfigFingerprint } from "./fingerprint"
import { applyHostModelInfoOverrides } from "./host-overrides"
import { parseProviderId } from "./provider-id"
import { toSdkProviderId } from "./sdk-provider-id"
import { adaptSdkModelInfo, CatalogShapeError } from "./shape-adapter"

type ProviderModelsRecord = Extract<ProviderModelsResult, { ok: true }>

type CacheKey = `${string}:${string}`

interface ProviderModelsCacheOptions {
	readonly ttlMs: number
	now(): number
}

interface ResolveRecordOptions {
	readonly providerId: ProviderId
	readonly fingerprint: Fingerprint
	readonly forceRefresh?: boolean
	load(): Promise<ProviderModelsRecord>
}

const DEFAULT_MODEL_CACHE_TTL_MS = 5 * 60 * 1000
const DEFAULT_MODEL_CATALOG_CONFIG: ModelCatalogConfig = {
	loadLatestOnInit: true,
	loadPrivateOnAuth: true,
	failOnError: false,
	cacheTtlMs: 0,
}

// The extension does not yet bridge SDK provider OAuth callbacks into its
// webview. Keep device-only providers out of the picker until selecting one
// can start and display the shared Core authentication flow.
const EXTENSION_UNSUPPORTED_OAUTH_PROVIDERS = new Set(["xai-subscription"])

/**
 * Normalize the SDK's usage-cost-display answer (string union) into the
 * extension's {@link UsageCostDisplay} type. The SDK function takes a
 * provider id (not metadata) and consults its own registry; we forward
 * the id and trust the answer rather than re-parsing the metadata bag.
 */
function readUsageCostDisplay(providerId: string): UsageCostDisplay {
	return resolveProviderUsageCostDisplay(providerId) === "hide" ? "hide" : "show"
}

function makeCacheKey(providerId: ProviderId, fingerprint: Fingerprint): CacheKey {
	return `${providerId}:${fingerprint}`
}

function assertRecordMatchesRequest(record: ProviderModelsRecord, providerId: ProviderId, fingerprint: Fingerprint): void {
	if (record.providerId !== providerId || record.configFingerprint !== fingerprint) {
		throw new Error(
			`ProviderCatalog cache invariant failed: loaded record ${record.providerId}/${record.configFingerprint} does not match requested ${providerId}/${fingerprint}`,
		)
	}
}

function createProviderModelsCache(options: ProviderModelsCacheOptions) {
	const records = new Map<CacheKey, { readonly record: ProviderModelsRecord; readonly expiresAt: number }>()
	const inFlight = new Map<CacheKey, Promise<ProviderModelsRecord>>()

	function get(providerId: ProviderId, fingerprint: Fingerprint): ProviderModelsRecord | undefined {
		const key = makeCacheKey(providerId, fingerprint)
		const entry = records.get(key)
		if (!entry) {
			return undefined
		}
		if (entry.expiresAt <= options.now()) {
			records.delete(key)
			return undefined
		}
		return entry.record
	}

	function set(record: ProviderModelsRecord, providerId = record.providerId, fingerprint = record.configFingerprint): void {
		assertRecordMatchesRequest(record, providerId, fingerprint)
		records.set(makeCacheKey(record.providerId, record.configFingerprint), {
			record,
			expiresAt: options.now() + options.ttlMs,
		})
	}

	function invalidateProviderExcept(providerId: ProviderId, fingerprintToKeep: Fingerprint): void {
		for (const [key, entry] of records) {
			if (entry.record.providerId === providerId && entry.record.configFingerprint !== fingerprintToKeep) {
				records.delete(key)
			}
		}
	}

	function resolve(optionsForRecord: ResolveRecordOptions): Promise<ProviderModelsRecord> {
		if (!optionsForRecord.forceRefresh) {
			const cached = get(optionsForRecord.providerId, optionsForRecord.fingerprint)
			if (cached) {
				return Promise.resolve(cached)
			}
		}

		const key = makeCacheKey(optionsForRecord.providerId, optionsForRecord.fingerprint)
		const existing = inFlight.get(key)
		if (existing) {
			return existing
		}

		const promise = optionsForRecord
			.load()
			.then((record) => {
				set(record, optionsForRecord.providerId, optionsForRecord.fingerprint)
				return record
			})
			.finally(() => {
				inFlight.delete(key)
			})
		inFlight.set(key, promise)
		return promise
	}

	return {
		get,
		set,
		invalidateProviderExcept,
		resolve,
		peek: get,
		_inFlightSize: () => inFlight.size,
		_cacheSize: () => records.size,
	}
}

function toSdkProviderConfig(config: EffectiveProviderConfig, selection: ModelSelection | undefined): ProviderConfig {
	return {
		providerId: toSdkProviderId(config.providerId),
		modelId: selection?.modelId ?? "",
		apiKey: config.apiKey,
		baseUrl: config.baseUrl,
		headers: config.headers ? { ...config.headers } : undefined,
		accessToken: config.auth?.accessToken,
		refreshToken: config.auth?.refreshToken,
		accountId: config.auth?.accountId,
		apiLine: config.apiLine === "china" || config.apiLine === "international" ? config.apiLine : undefined,
		region: config.gcp?.region ?? config.region,
		gcp: config.gcp ? { ...config.gcp } : undefined,
	}
}

function chooseDefaultModelId(sdkDefaultModelId: string | undefined, models: ReadonlyMap<string, unknown>): string {
	if (sdkDefaultModelId && models.has(sdkDefaultModelId)) {
		return sdkDefaultModelId
	}
	return models.keys().next().value ?? ""
}

function optionalNonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim()
	return trimmed ? trimmed : undefined
}

function toProviderListing(provider: ProviderListItem): ProviderListing {
	return {
		id: parseProviderId(provider.id),
		name: provider.name,
		defaultModelId: optionalNonEmpty(provider.defaultModelId),
		protocol: provider.protocol,
		// ProviderListing intentionally does not include full model-list data.
		// Reuse the lightweight description slot until the RPC-facing picker
		// contract decides whether it needs a generic provider description field.
		authDescription: optionalNonEmpty(provider.authDescription),
		// The SDK has the right signal for this on each provider (e.g.
		// `modelsSourceUrl` for ollama/lmstudio, or the `openai-compatible`
		// family with no curated catalog), but does not yet expose it
		// through a public helper. Until then this set is the host-side
		// fallback; remove it as soon as upstream exposes the signal.
		allowsCustomModelIds: providerAllowsCustomModelIds(provider.id),
		usageCostDisplay: readUsageCostDisplay(provider.id),
	}
}

async function listSdkProviderListings(): Promise<ReadonlyArray<ProviderListing>> {
	const manager = getProviderSettingsManager()
	const featureFlags = getFeatureFlagsService()
	const { providers } = await listLocalProviders(manager, {
		isClinePassEnabled: featureFlags.getBooleanFlagEnabled(FeatureFlag.CLINE_PASS),
	})
	return providers.filter((provider) => !EXTENSION_UNSUPPORTED_OAUTH_PROVIDERS.has(provider.id)).map(toProviderListing)
}

async function resolveSdkModels(
	providerId: ProviderId,
	fingerprint: Fingerprint,
	config: EffectiveProviderConfig,
	selection: ModelSelection | undefined,
	now: () => number,
): Promise<ProviderModelsRecord> {
	const sdkProviderId = toSdkProviderId(providerId)
	const resolved = await resolveProviderConfig(
		sdkProviderId,
		DEFAULT_MODEL_CATALOG_CONFIG,
		toSdkProviderConfig(config, selection),
	)
	const sdkModels = resolved?.knownModels ?? {}
	const models = new Map(
		Object.entries(sdkModels).map(([modelId, sdkInfo]) => [
			modelId,
			applyHostModelInfoOverrides(providerId, modelId, adaptSdkModelInfo(sdkInfo)),
		]),
	)
	return {
		ok: true,
		providerId,
		configFingerprint: fingerprint,
		models,
		defaultModelId: chooseDefaultModelId(resolved?.modelId, models),
		source: "sdk-dynamic",
		fetchedAt: now(),
	}
}

function toCatalogError(error: unknown): CatalogError {
	if (error instanceof CatalogShapeError) {
		return {
			kind: "shape",
			message: error.message,
		}
	}
	if (error instanceof Error) {
		return {
			kind: "unknown",
			message: error.message,
		}
	}
	return {
		kind: "unknown",
		message: String(error),
	}
}

/**
 * Internal test hook for cache/in-flight behavior. Not part of the public
 * model-catalog API; production callers should use createProviderCatalog.
 */
export const _testing = {
	createProviderModelsCache,
	makeCacheKey,
	assertRecordMatchesRequest,
}

/**
 * Create a {@link ProviderCatalog}.
 *
 * Accepts a read-only {@link ProviderConfigReader} (not the full store), so
 * the catalog cannot write to the store: it has no `write`/`commitSelection`
 * access by construction.
 */
export function createProviderCatalog(reader: ProviderConfigReader): ProviderCatalog {
	const now = () => Date.now()
	const cache = createProviderModelsCache({ ttlMs: DEFAULT_MODEL_CACHE_TTL_MS, now })
	let providerListingsPromise: Promise<ReadonlyArray<ProviderListing>> | undefined
	const modelListeners = new Map<ProviderId, Set<(event: ProviderModelsEvent) => void>>()

	function notifyModelListeners(providerId: ProviderId, result: ProviderModelsResult): void {
		const listeners = modelListeners.get(providerId)
		if (!listeners) {
			return
		}
		const event: ProviderModelsEvent = { providerId, result }
		for (const listener of [...listeners]) {
			listener(event)
		}
	}

	reader.subscribe((event) => {
		if (event.kind !== "fields") {
			return
		}
		const latestConfig = reader.read(event.providerId)
		const latestFingerprint = computeConfigFingerprint(event.providerId, latestConfig)
		cache.invalidateProviderExcept(event.providerId, latestFingerprint)
	})
	return {
		async listProviders(): Promise<ReadonlyArray<ProviderListing>> {
			providerListingsPromise ??= listSdkProviderListings().catch((error) => {
				providerListingsPromise = undefined
				throw error
			})
			return providerListingsPromise
		},

		invalidateProviderListings(): void {
			providerListingsPromise = undefined
		},

		async resolveModels(
			providerId: ProviderId,
			options?: { readonly forceRefresh?: boolean },
		): Promise<ProviderModelsResult> {
			const config = reader.read(providerId)
			const fingerprint = computeConfigFingerprint(providerId, config)
			// Selection is not part of model-list identity; it is only a hint for
			// SDK config surfaces that require a model id. The cache stays keyed
			// solely by provider + effective config fingerprint.
			const selection = reader.readSelection(providerId, "act")
			let result: ProviderModelsResult
			try {
				result = await cache.resolve({
					providerId,
					fingerprint,
					forceRefresh: options?.forceRefresh,
					load: () => resolveSdkModels(providerId, fingerprint, config, selection, now),
				})
			} catch (error) {
				result = {
					ok: false,
					providerId,
					configFingerprint: fingerprint,
					error: toCatalogError(error),
					fetchedAt: now(),
				}
			}
			notifyModelListeners(providerId, result)
			return result
		},

		peekModels(providerId: ProviderId): ProviderModelsResult | undefined {
			const config = reader.read(providerId)
			const fingerprint = computeConfigFingerprint(providerId, config)
			return cache.peek(providerId, fingerprint)
		},

		subscribe(providerId: ProviderId, listener: (event: ProviderModelsEvent) => void): Disposable {
			let listeners = modelListeners.get(providerId)
			if (!listeners) {
				listeners = new Set()
				modelListeners.set(providerId, listeners)
			}
			listeners.add(listener)
			return {
				dispose(): void {
					listeners.delete(listener)
					if (listeners.size === 0) {
						modelListeners.delete(providerId)
					}
				},
			}
		},
	}
}

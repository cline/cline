import { type ModelCatalogConfig, resolveProviderConfig } from "@clinebot/core"
import type { ProviderConfig } from "@clinebot/llms"
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
} from "./contracts"
import { computeConfigFingerprint } from "./fingerprint"
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
		_inFlightSize: () => inFlight.size,
		_cacheSize: () => records.size,
	}
}

function toSdkProviderConfig(config: EffectiveProviderConfig, selection: ModelSelection | undefined): ProviderConfig {
	return {
		providerId: config.providerId,
		modelId: selection?.modelId ?? "",
		apiKey: config.apiKey,
		baseUrl: config.baseUrl,
		headers: config.headers ? { ...config.headers } : undefined,
		accessToken: config.auth?.accessToken,
		refreshToken: config.auth?.refreshToken,
		accountId: config.auth?.accountId,
		apiLine: config.apiLine === "china" || config.apiLine === "international" ? config.apiLine : undefined,
		region: config.region,
	}
}

function chooseDefaultModelId(sdkDefaultModelId: string | undefined, models: ReadonlyMap<string, unknown>): string {
	if (sdkDefaultModelId && models.has(sdkDefaultModelId)) {
		return sdkDefaultModelId
	}
	return models.keys().next().value ?? ""
}

async function resolveSdkModels(
	providerId: ProviderId,
	fingerprint: Fingerprint,
	config: EffectiveProviderConfig,
	selection: ModelSelection | undefined,
	now: () => number,
): Promise<ProviderModelsRecord> {
	const resolved = await resolveProviderConfig(providerId, DEFAULT_MODEL_CATALOG_CONFIG, toSdkProviderConfig(config, selection))
	const sdkModels = resolved?.knownModels ?? {}
	const models = new Map(Object.entries(sdkModels).map(([modelId, sdkInfo]) => [modelId, adaptSdkModelInfo(sdkInfo)]))
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
 * Accepts a read-only {@link ProviderConfigReader} (not the full store).
 * Enforces invariant C1 by type: the catalog cannot write to the store,
 * and has no `write`/`commitSelection` access by construction.
 */
export function createProviderCatalog(reader: ProviderConfigReader): ProviderCatalog {
	const now = () => Date.now()
	const cache = createProviderModelsCache({ ttlMs: DEFAULT_MODEL_CACHE_TTL_MS, now })
	reader.subscribe((event) => {
		if (event.kind !== "fields") {
			return
		}
		const latestConfig = reader.read(event.providerId)
		const latestFingerprint = computeConfigFingerprint(event.providerId, latestConfig)
		cache.invalidateProviderExcept(event.providerId, latestFingerprint)
	})
	const unimplemented = (method: string): never => {
		throw new Error(`ProviderCatalog.${method}: not implemented (Phase 3 resolver pending)`)
	}

	return {
		async listProviders(): Promise<ReadonlyArray<ProviderListing>> {
			return unimplemented("listProviders")
		},

		async resolveModels(
			providerId: ProviderId,
			options?: { readonly forceRefresh?: boolean },
		): Promise<ProviderModelsResult> {
			const config = reader.read(providerId)
			const fingerprint = computeConfigFingerprint(providerId, config)
			// Selection is not part of model-list identity; it is only a hint for
			// SDK config surfaces that require a model id. Phase 3 catalog caching
			// remains keyed solely by provider + effective config fingerprint.
			const selection = reader.readSelection(providerId, "act")
			try {
				return await cache.resolve({
					providerId,
					fingerprint,
					forceRefresh: options?.forceRefresh,
					load: () => resolveSdkModels(providerId, fingerprint, config, selection, now),
				})
			} catch (error) {
				return {
					ok: false,
					providerId,
					configFingerprint: fingerprint,
					error: toCatalogError(error),
					fetchedAt: now(),
				}
			}
		},

		subscribe(_providerId: ProviderId, _listener: (event: ProviderModelsEvent) => void): Disposable {
			return unimplemented("subscribe")
		},
	}
}

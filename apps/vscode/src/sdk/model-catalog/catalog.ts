import { listLocalProviders, type ModelCatalogConfig, resolveProviderConfig } from "@cline/core"
import { type ProviderConfig, resolveProviderUsageCostDisplay } from "@cline/llms"
import { type ProviderListItem } from "@cline/shared"
import { type ModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"
import { isVscodeUnsupportedProvider } from "@shared/model-catalog/provider-helpers"
import { StateManager } from "@/core/storage/StateManager"
import { getFeatureFlagsService } from "@/services/feature-flags"
import { FeatureFlag } from "@/shared/services/feature-flags/feature-flags"
import type {
	RemoteBedrockCustomModelEntry,
	RemoteProviderModelEntry,
	RemoteProviderModelSettings,
} from "@/shared/storage/state-keys"
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
import { buildEffectiveProviderConfig } from "./effective-config"
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

const DEFAULT_MODEL_CATALOG_CONFIG: ModelCatalogConfig = {
	loadLatestOnInit: true,
	loadPrivateOnAuth: true,
	failOnError: false,
	cacheTtlMs: 0,
}

// Providers whose model id is user-supplied free text rather than a fixed
// catalog selection. The SDK catalog for these either has no curated model
// list (openai-compatible: bring-your-own base URL + model) or a host-fetched
// list that the user can also bypass (ollama/lmstudio/litellm). For these,
// the picker must allow arbitrary model ids and model resolution must honor
// the requested id instead of coercing to the catalog default.
const CUSTOM_MODEL_ID_PROVIDER_IDS = new Set(["openai-compatible", "ollama", "lmstudio", "litellm", "bedrock"])

/**
 * Whether a provider id accepts a user-supplied (custom) model id. Exported so
 * model-resolution code paths (e.g. `resolveModelInfo`) can honor a custom id
 * for these providers rather than falling back to the SDK catalog default.
 *
 * Accepts either the extension or SDK provider id spelling (the extension's
 * `openai` maps to the SDK's `openai-compatible`).
 */
export function providerAllowsCustomModelIds(providerId: string): boolean {
	const parsedProviderId = parseProviderId(providerId)
	return CUSTOM_MODEL_ID_PROVIDER_IDS.has(toSdkProviderId(providerId)) && !hasRemoteModelAllowlist(parsedProviderId)
}

export function providerHasRemoteModelAllowlist(providerId: string): boolean {
	return hasRemoteModelAllowlist(parseProviderId(providerId))
}

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

function isSdkAwsAuthentication(value: unknown): value is NonNullable<ProviderConfig["aws"]>["authentication"] {
	return value === "iam" || value === "api-key" || value === "apikey" || value === "profile"
}

function normalizeSdkAwsAuthentication(value: unknown): NonNullable<ProviderConfig["aws"]>["authentication"] | undefined {
	if (value === "credentials") {
		return "iam"
	}
	return isSdkAwsAuthentication(value) ? value : undefined
}

function toSdkAwsConfig(config: EffectiveProviderConfig["aws"]): ProviderConfig["aws"] {
	if (!config) {
		return undefined
	}
	return {
		...config,
		authentication: normalizeSdkAwsAuthentication(config.authentication),
	}
}

function isBedrockApiKeyAuthentication(authentication: unknown): boolean {
	return authentication === "api-key" || authentication === "apikey"
}

function isSdkSapApi(value: unknown): value is NonNullable<ProviderConfig["sap"]>["api"] {
	return value === "orchestration" || value === "foundation-models"
}

function toSdkSapConfig(config: EffectiveProviderConfig["sap"]): ProviderConfig["sap"] {
	if (!config) {
		return undefined
	}
	return {
		...config,
		api: isSdkSapApi(config.api) ? config.api : undefined,
		defaultSettings: config.defaultSettings ? { ...config.defaultSettings } : undefined,
	}
}

function isSdkOcaMode(value: unknown): value is NonNullable<ProviderConfig["oca"]>["mode"] {
	return value === "internal" || value === "external"
}

function toSdkOcaConfig(config: EffectiveProviderConfig["oca"]): ProviderConfig["oca"] {
	if (!config) {
		return undefined
	}
	return {
		...config,
		mode: isSdkOcaMode(config.mode) ? config.mode : undefined,
	}
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
	const providerId = toSdkProviderId(config.providerId)
	const aws = toSdkAwsConfig(config.aws)
	const apiKey = providerId === "bedrock" && !isBedrockApiKeyAuthentication(aws?.authentication) ? undefined : config.apiKey

	return {
		providerId,
		modelId: selection?.modelId ?? "",
		...(apiKey ? { apiKey } : {}),
		baseUrl: config.baseUrl,
		headers: config.headers ? { ...config.headers } : undefined,
		accessToken: config.auth?.accessToken,
		refreshToken: config.auth?.refreshToken,
		accountId: config.auth?.accountId,
		apiLine: config.apiLine === "china" || config.apiLine === "international" ? config.apiLine : undefined,
		region: config.gcp?.region ?? config.aws?.region ?? config.region,
		gcp: config.gcp ? { ...config.gcp } : undefined,
		azure: config.azure ? { ...config.azure } : undefined,
		aws,
		sap: toSdkSapConfig(config.sap),
		oca: toSdkOcaConfig(config.oca),
	}
}

function readRemoteProviderModelSettings(providerId: ProviderId): RemoteProviderModelSettings[string] | undefined {
	try {
		const manager = StateManager.get() as { getRemoteConfigSettings?: () => unknown }
		const settings = manager.getRemoteConfigSettings?.()
		if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
			return undefined
		}
		const remoteProviderModelSettings = (settings as { remoteProviderModelSettings?: RemoteProviderModelSettings })
			.remoteProviderModelSettings
		return remoteProviderModelSettings?.[toSdkProviderId(providerId)] ?? remoteProviderModelSettings?.[providerId]
	} catch {
		return undefined
	}
}

function readRemoteAllowedModelIdsForProvider(providerId: ProviderId): readonly string[] {
	const settings = readRemoteProviderModelSettings(providerId)
	return [
		...(settings?.models ?? []).map((model) => model.id),
		...(settings?.bedrockCustomModels ?? []).map((model) => model.name),
	].filter((modelId) => modelId.trim().length > 0)
}

export function readRemoteAllowedModelIds(providerId: string): readonly string[] {
	return readRemoteAllowedModelIdsForProvider(parseProviderId(providerId))
}

function hasRemoteModelAllowlist(providerId: ProviderId): boolean {
	return readRemoteAllowedModelIdsForProvider(providerId).length > 0
}

function readRemoteConfigCacheKey(): string {
	try {
		const manager = StateManager.get() as { getRemoteConfigSettings?: () => unknown }
		return JSON.stringify(manager.getRemoteConfigSettings?.() ?? {}) ?? "{}"
	} catch {
		return "{}"
	}
}

function withRemoteModelInfo(base: ModelInfo | undefined, entry: RemoteProviderModelEntry): ModelInfo {
	const next: ModelInfo & { isR1FormatRequired?: boolean } = {
		...(base ?? openAiModelInfoSafeDefaults),
		name: base?.name ?? entry.id,
	}
	if (entry.contextWindow !== undefined) next.contextWindow = entry.contextWindow
	if (entry.maxTokens !== undefined) next.maxTokens = entry.maxTokens
	if (entry.inputPrice !== undefined) next.inputPrice = entry.inputPrice
	if (entry.outputPrice !== undefined) next.outputPrice = entry.outputPrice
	if (entry.supportsImages !== undefined) next.supportsImages = entry.supportsImages
	if (entry.promptCachingEnabled !== undefined) next.supportsPromptCache = entry.promptCachingEnabled
	if (entry.temperature !== undefined) next.temperature = entry.temperature
	if (entry.isR1FormatRequired !== undefined) next.isR1FormatRequired = entry.isR1FormatRequired
	if (entry.thinkingBudgetTokens !== undefined) {
		next.thinkingConfig = { ...(next.thinkingConfig ?? {}), maxBudget: entry.thinkingBudgetTokens }
	}
	return next
}

function withRemoteBedrockCustomModelInfo(
	models: ReadonlyMap<string, ModelInfo>,
	entry: RemoteBedrockCustomModelEntry,
): ModelInfo {
	const base = models.get(entry.baseModelId) ?? openAiModelInfoSafeDefaults
	return {
		...base,
		name: entry.name,
		description: base.description
			? `${base.description} Base model: ${entry.baseModelId}.`
			: `Base model: ${entry.baseModelId}.`,
		...(entry.thinkingBudgetTokens !== undefined
			? { thinkingConfig: { ...(base.thinkingConfig ?? {}), maxBudget: entry.thinkingBudgetTokens } }
			: {}),
	}
}

function applyRemoteModelSettings(record: ProviderModelsRecord, providerId: ProviderId): ProviderModelsRecord {
	const settings = readRemoteProviderModelSettings(providerId)
	if (!settings?.models?.length && !settings?.bedrockCustomModels?.length) {
		return record
	}

	const nextModels = new Map<string, ModelInfo>()
	for (const entry of settings.models ?? []) {
		nextModels.set(entry.id, withRemoteModelInfo(record.models.get(entry.id), entry))
	}
	for (const customModel of settings.bedrockCustomModels ?? []) {
		nextModels.set(customModel.name, withRemoteBedrockCustomModelInfo(record.models, customModel))
	}

	return {
		...record,
		models: nextModels,
		defaultModelId: nextModels.has(record.defaultModelId) ? record.defaultModelId : (nextModels.keys().next().value ?? ""),
		source: "host-adapter",
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

function isProviderConfigFieldValue(value: unknown): boolean {
	return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null
}

function readConfigPathValue(config: EffectiveProviderConfig, path: string): unknown {
	let current: unknown = config
	for (const segment of path.split(".")) {
		if (typeof current !== "object" || current === null || Array.isArray(current)) {
			return undefined
		}
		current = (current as Record<string, unknown>)[segment]
	}
	return isProviderConfigFieldValue(current) || path === "headers" ? current : undefined
}

function readEffectiveConfigValues(provider: ProviderListItem): Record<string, unknown> | undefined {
	const fields = provider.configFields?.filter((field) => field.path && !field.secret)
	if (!fields?.length) {
		return undefined
	}

	const effectiveConfig = buildEffectiveProviderConfig(parseProviderId(provider.id))
	const values: Record<string, unknown> = {}
	for (const field of fields) {
		const value = readConfigPathValue(effectiveConfig, field.path)
		if (value !== undefined) {
			values[field.path] = value
		}
	}
	return Object.keys(values).length > 0 ? values : undefined
}

function toProviderListing(provider: ProviderListItem): ProviderListing {
	const effectiveConfigValues = readEffectiveConfigValues(provider)
	const providerId = parseProviderId(provider.id)
	return {
		id: providerId,
		name: provider.name,
		defaultModelId: optionalNonEmpty(provider.defaultModelId),
		protocol: provider.protocol,
		authMethod: provider.authMethod,
		authDescription: optionalNonEmpty(provider.authDescription),
		baseUrlDescription: optionalNonEmpty(provider.baseUrlDescription),
		configFields: provider.configFields,
		configValues: effectiveConfigValues
			? { ...(provider.configValues ?? {}), ...effectiveConfigValues }
			: provider.configValues,
		allowsCustomModelIds: CUSTOM_MODEL_ID_PROVIDER_IDS.has(providerId) && !hasRemoteModelAllowlist(providerId),
		usageCostDisplay: readUsageCostDisplay(provider.id),
	}
}

function isVscodeSupportedProvider(provider: ProviderListItem): boolean {
	if (isVscodeUnsupportedProvider(provider.id)) {
		return false
	}
	if (provider.authMethod === "local") {
		return false
	}
	return true
}

function listSdkProviderListings(): Promise<ReadonlyArray<ProviderListing>> {
	const manager = getProviderSettingsManager()
	return listLocalProviders(manager, {
		isClinePassEnabled: getFeatureFlagsService().getBooleanFlagEnabled(FeatureFlag.CLINE_PASS),
	}).then(({ providers }) => providers.filter(isVscodeSupportedProvider).map(toProviderListing))
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
 * Create a {@link ProviderCatalog}.
 *
 * Accepts a read-only {@link ProviderConfigReader} (not the full store), so
 * the catalog cannot write to the store: it has no `write`/`commitSelection`
 * access by construction.
 */
export function createProviderCatalog(reader: ProviderConfigReader): ProviderCatalog {
	const now = () => Date.now()
	const cache = createProviderModelsCache({ ttlMs: 5 * 60 * 1000, now })
	let providerListingsPromise: Promise<ReadonlyArray<ProviderListing>> | undefined
	let providerListingsRemoteConfigKey: string | undefined
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
		providerListingsPromise = undefined
		const latestConfig = reader.read(event.providerId)
		const latestFingerprint = computeConfigFingerprint(event.providerId, latestConfig)
		cache.invalidateProviderExcept(event.providerId, latestFingerprint)
	})
	return {
		async listProviders(): Promise<ReadonlyArray<ProviderListing>> {
			const remoteConfigKey = readRemoteConfigCacheKey()
			if (!providerListingsPromise || providerListingsRemoteConfigKey !== remoteConfigKey) {
				providerListingsRemoteConfigKey = remoteConfigKey
				providerListingsPromise = listSdkProviderListings().catch((error) => {
					providerListingsPromise = undefined
					providerListingsRemoteConfigKey = undefined
					throw error
				})
			}
			return providerListingsPromise
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
				result = applyRemoteModelSettings(result, providerId)
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
			const result = cache.peek(providerId, fingerprint)
			return result ? applyRemoteModelSettings(result, providerId) : undefined
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

/**
 * Internal test hook for cache/in-flight behavior. Not part of the public
 * model-catalog API; production callers should use createProviderCatalog.
 */
export const _testing = {
	createProviderModelsCache,
	makeCacheKey,
	assertRecordMatchesRequest,
}

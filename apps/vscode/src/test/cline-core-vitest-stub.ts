import { getGeneratedModelsForProvider, MODEL_COLLECTIONS_BY_PROVIDER_ID } from "@cline/llms"

export interface OAuthCredentials {
	accessToken?: string
	refreshToken?: string
	accountId?: string
}

export interface StartSessionResult {
	sessionId: string
}

export interface SessionHistoryRecord {
	id: string
}

export type CoreSessionEvent = { type: string; payload?: unknown }

export type TelemetryProperties = Record<string, unknown>

export interface TelemetryMetadata {
	extension_version: string
	cline_type: string
	platform: string
	platform_version: string
	os_type: string
	os_version: string
	is_dev?: string
}

export interface ITelemetryService {
	setDistinctId(distinctId?: string): void
	setMetadata(metadata: Partial<TelemetryMetadata>): void
	updateMetadata(metadata: Partial<TelemetryMetadata>): void
	setCommonProperties(properties: TelemetryProperties): void
	updateCommonProperties(properties: TelemetryProperties): void
	isEnabled(): boolean
	capture(input: { event: string; properties?: TelemetryProperties }): void
	captureRequired(event: string, properties?: TelemetryProperties): void
	recordCounter(name: string, value: number, attributes?: TelemetryProperties, description?: string, required?: boolean): void
	recordHistogram(name: string, value: number, attributes?: TelemetryProperties, description?: string, required?: boolean): void
	recordGauge(
		name: string,
		value: number | null,
		attributes?: TelemetryProperties,
		description?: string,
		required?: boolean,
	): void
	flush(): Promise<void>
	dispose(): Promise<void>
}

export interface ConfiguredTelemetryHandle {
	readonly telemetry: ITelemetryService
	flush(): Promise<void>
	dispose(): Promise<void>
}

function createNoopTelemetry(): ITelemetryService {
	return {
		setDistinctId() {},
		setMetadata() {},
		updateMetadata() {},
		setCommonProperties() {},
		updateCommonProperties() {},
		isEnabled: () => false,
		capture() {},
		captureRequired() {},
		recordCounter() {},
		recordHistogram() {},
		recordGauge() {},
		flush: async () => {},
		dispose: async () => {},
	}
}

export function createClineTelemetryServiceConfig(config: Record<string, unknown> = {}) {
	return {
		enabled: false,
		metadata: {
			extension_version: "test",
			cline_type: "test",
			platform: "test",
			platform_version: "test",
			os_type: "test",
			os_version: "test",
		},
		...config,
	}
}

export function createConfiguredTelemetryHandle(): ConfiguredTelemetryHandle {
	const telemetry = createNoopTelemetry()
	return {
		telemetry,
		flush: async () => {},
		dispose: async () => {},
	}
}

interface ProviderSettingsState {
	providers: Record<string, Record<string, unknown>>
	lastUsedProvider?: string
}

// State is keyed by dataDir so that — like the real file-backed manager —
// two managers constructed for the same directory observe the same providers.
// (Tests isolate by using a unique dataDir per test.)
const providerSettingsStores = new Map<string, ProviderSettingsState>()

export class ProviderSettingsManager {
	private readonly filePath: string
	private readonly state: ProviderSettingsState

	constructor(options?: { filePath?: string; dataDir?: string }) {
		this.filePath = options?.filePath ?? options?.dataDir ?? "<default>"
		let store = providerSettingsStores.get(this.filePath)
		if (!store) {
			store = { providers: {} }
			providerSettingsStores.set(this.filePath, store)
		}
		this.state = store
	}

	getFilePath(): string {
		return this.filePath
	}

	read(): ProviderSettingsState {
		return { providers: { ...this.state.providers }, lastUsedProvider: this.state.lastUsedProvider }
	}

	getProviderSettings(providerId: string): Record<string, unknown> | undefined {
		return this.state.providers[providerId]
	}

	getLastUsedProviderSettings(): Record<string, unknown> | undefined {
		return this.state.lastUsedProvider ? this.state.providers[this.state.lastUsedProvider] : undefined
	}

	saveProviderSettings(settings: Record<string, unknown>, options?: { setLastUsed?: boolean }): ProviderSettingsState {
		const provider = settings.provider
		if (typeof provider !== "string") {
			throw new Error("provider is required")
		}
		this.state.providers[provider] = { ...settings }
		if (options?.setLastUsed !== false) {
			this.state.lastUsedProvider = provider
		}
		return this.read()
	}
}

export interface ModelCatalogConfig {
	loadLatestOnInit?: boolean
	loadPrivateOnAuth?: boolean
	failOnError?: boolean
	cacheTtlMs?: number
}

export async function resolveProviderConfig(
	providerId: string,
	_config?: ModelCatalogConfig,
	providerConfig?: { modelId?: string },
) {
	const knownModels = getGeneratedModelsForProvider(providerId)
	const requestedModelId = providerConfig?.modelId?.trim()
	const collection = MODEL_COLLECTIONS_BY_PROVIDER_ID[providerId]
	const manifestDefaultModelId = collection?.provider.defaultModelId
	const defaultModelId =
		manifestDefaultModelId && knownModels[manifestDefaultModelId]
			? manifestDefaultModelId
			: Object.keys(knownModels)[0] || Object.keys(collection?.models ?? {})[0]
	const modelId = requestedModelId && knownModels[requestedModelId] ? requestedModelId : defaultModelId
	return { modelId, knownModels }
}

export interface ClineRecommendedModel {
	id: string
	name: string
	description: string
	tags: string[]
}

export interface ClineRecommendedModelsData {
	recommended: ClineRecommendedModel[]
	free: ClineRecommendedModel[]
}

export async function fetchClineRecommendedModels(_options?: {
	baseUrl?: string
	fetchImpl?: typeof fetch
}): Promise<ClineRecommendedModelsData> {
	return { recommended: [], free: [] }
}

export function createOAuthClientCallbacks() {
	return {}
}

export async function getValidClineCredentials(): Promise<OAuthCredentials | undefined> {
	return undefined
}

export async function loginClineOAuth(): Promise<OAuthCredentials> {
	return {}
}

export async function loginOcaOAuth(): Promise<OAuthCredentials> {
	return {}
}

export async function loginOpenAICodex(): Promise<OAuthCredentials> {
	return {}
}

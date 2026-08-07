import { readFileSync, writeFileSync } from "node:fs"
import { getGeneratedModelsForProvider, MODEL_COLLECTIONS_BY_PROVIDER_ID } from "@cline/llms"
import { createFileReadExecutor } from "../../../../sdk/packages/core/src/extensions/tools/executors/file-read"

export interface OAuthCredentials {
	accessToken?: string
	refreshToken?: string
	accountId?: string
}

export interface StartSessionResult {
	sessionId: string
}

export const MAX_COMMAND_OUTPUT_CHARS = 200_000

export interface StoredModelEntry {
	id?: string
	name?: string
	maxTokens?: number
	contextWindow?: number
	maxInputTokens?: number
	capabilities?: string[]
	[key: string]: unknown
}

export interface StoredModelsFile {
	version: 1
	providers: Record<string, { models?: Record<string, StoredModelEntry> }>
}

const modelsFiles = new Map<string, StoredModelsFile>()

function cloneModelsFile(modelsFile: StoredModelsFile): StoredModelsFile {
	return structuredClone(modelsFile)
}

export function resetModelsFileState(): void {
	modelsFiles.clear()
}

export function readModelsFileSync(filePath: string): StoredModelsFile {
	return cloneModelsFile(modelsFiles.get(filePath) ?? { version: 1, providers: {} })
}

export function writeModelsFileSync(filePath: string, next: StoredModelsFile): void {
	modelsFiles.set(filePath, cloneModelsFile(next))
}

export function resolveModelsRegistryPath(): string {
	return "/tmp/models.json"
}

export function ensureCustomProvidersLoadedSync(): void {}

// Real implementation re-exported from the sdk source (same pattern as the
// apply-patch executors below) so store writes are reflected in the live
// @cline/llms registry exactly as in production. Tests that touch it must
// reset the registry (LlmsModels.resetRegistry()) between tests.
export {
	StoredModelEntrySchema,
	syncStoredProviderRegistration,
} from "../../../../sdk/packages/core/src/services/providers/local-provider-registry"

export type GlobalCompactionStrategy = "basic" | "agentic"

export function readCompactionStrategyGlobally(): GlobalCompactionStrategy {
	try {
		const settings = JSON.parse(readFileSync(process.env.CLINE_GLOBAL_SETTINGS_PATH ?? "", "utf8"))
		return settings.compactionStrategy === "basic" ? "basic" : "agentic"
	} catch {
		return "agentic"
	}
}

export function setCompactionStrategyGlobally(compactionStrategy: GlobalCompactionStrategy): void {
	const filePath = process.env.CLINE_GLOBAL_SETTINGS_PATH
	if (filePath) {
		let settings = {}
		try {
			settings = JSON.parse(readFileSync(filePath, "utf8"))
		} catch {}
		writeFileSync(filePath, JSON.stringify({ ...settings, compactionStrategy }))
	}
}

export function truncateCommandOutput(output: string): string {
	return output
}

export class CommandExitError extends Error {
	constructor(
		readonly exitCode: number,
		readonly output: string,
	) {
		super(`Command exited with code ${exitCode}`)
		this.name = "CommandExitError"
	}
}

export function createShellExecutor() {
	return async () => ""
}

export { augmentMcpTimeoutError } from "../../../../sdk/packages/core/src/extensions/mcp/timeout"
// The real createShellTool, so tests exercise the actual description
// building and shell classification (getShellKind) rather than a stub that
// would have to duplicate those invariants.
export { createShellTool } from "../../../../sdk/packages/core/src/extensions/tools/definitions"
// Real (dependency-light) edit-executor implementations, re-exported from the sdk source so
// the diff-edit coordinator and its tests exercise the actual content/parse semantics. These
// modules only pull in node:fs/node:path and the patch parser — not the heavy core runtime.
export {
	computePatchChanges,
	createApplyPatchExecutor,
	type PatchFileChange,
} from "../../../../sdk/packages/core/src/extensions/tools/executors/apply-patch"
export { PATCH_MARKERS, PatchActionType } from "../../../../sdk/packages/core/src/extensions/tools/executors/apply-patch-parser"
export { createEditorExecutor } from "../../../../sdk/packages/core/src/extensions/tools/executors/editor"
export type { EditFileInput } from "../../../../sdk/packages/core/src/extensions/tools/schemas"
export type { ApplyPatchExecutor, EditorExecutor, ToolExecutors } from "../../../../sdk/packages/core/src/extensions/tools/types"

// Real file-read executor (dependency-light: node:fs/node:path + @cline/shared/storage)
// so the workspace read override and its tests exercise the actual read semantics.
// Only the readFile executor is provided; the heavy executors are not needed in tests.
export function createDefaultExecutors() {
	return { readFile: createFileReadExecutor() }
}

export interface SessionHistoryRecord {
	id: string
	metadata?: Record<string, unknown>
}

export interface CheckpointEntry {
	ref: string
	createdAt: number
	runCount: number
	kind?: "stash" | "commit"
}

export function readSessionCheckpointHistory(session: { metadata?: Record<string, unknown> } | undefined): CheckpointEntry[] {
	const checkpoint =
		session?.metadata?.checkpoint &&
		typeof session.metadata.checkpoint === "object" &&
		!Array.isArray(session.metadata.checkpoint)
			? (session.metadata.checkpoint as Record<string, unknown>)
			: undefined
	const history = Array.isArray(checkpoint?.history) ? checkpoint.history : []
	return history.flatMap((entry): CheckpointEntry[] => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			return []
		}
		const record = entry as Record<string, unknown>
		const ref = typeof record.ref === "string" ? record.ref.trim() : ""
		const createdAt = Number(record.createdAt ?? 0)
		const runCount = Number(record.runCount ?? 0)
		if (!ref || !Number.isFinite(createdAt) || !Number.isInteger(runCount) || runCount < 1) {
			return []
		}
		const kind = record.kind === "stash" || record.kind === "commit" ? record.kind : undefined
		return [{ ref, createdAt, runCount, ...(kind ? { kind } : {}) }]
	})
}

export function findCheckpointForRun(history: readonly CheckpointEntry[], runCount: number): CheckpointEntry | undefined {
	return history.reduce<CheckpointEntry | undefined>((best, entry) => {
		if (entry.runCount > runCount) {
			return best
		}
		if (!best || entry.runCount > best.runCount) {
			return entry
		}
		return best
	}, undefined)
}

export interface CheckpointContentDiff {
	filePath: string
	leftContent: string
	rightContent: string
}

export interface CheckpointWorkspaceCompareResult {
	checkpoint: CheckpointEntry
	cwd: string
	diffs: CheckpointContentDiff[]
}

export async function compareCheckpointToWorkspace(): Promise<CheckpointWorkspaceCompareResult> {
	throw new Error("compareCheckpointToWorkspace is not implemented in the Vitest @cline/core stub")
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
	emitProviderCreated?(): void
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

export function createClineTelemetryServiceMetadata(overrides: Partial<TelemetryMetadata> = {}): TelemetryMetadata {
	// Mirrors @cline/shared createClineTelemetryServiceMetadata defaults.
	return {
		extension_version: "unknown",
		cline_type: "unknown",
		platform: "terminal",
		platform_version: process?.version || "unknown",
		os_type: process?.platform || "unknown",
		os_version: process?.platform === "win32" ? (process?.env?.OS ?? "unknown") : "unknown",
		...overrides,
	}
}

export function resolveCoreDistinctId(distinctId?: string): string {
	// The real implementation falls back to a persisted machine id; tests only
	// need the pass-through behavior for an explicitly provided id.
	return distinctId ?? "stub-core-distinct-id"
}

export interface ITelemetryAdapter {
	readonly name: string
	emit(event: string, properties?: TelemetryProperties): void
	emitRequired(event: string, properties?: TelemetryProperties): void
	recordCounter(name: string, value: number, attributes?: TelemetryProperties, description?: string, required?: boolean): void
	recordHistogram(name: string, value: number, attributes?: TelemetryProperties, description?: string, required?: boolean): void
	recordGauge(
		name: string,
		value: number | null,
		attributes?: TelemetryProperties,
		description?: string,
		required?: boolean,
	): void
	isEnabled(): boolean
	setDistinctId(distinctId?: string): void
	setCommonProperties(properties: TelemetryProperties): void
	updateCommonProperties(properties: TelemetryProperties): void
	flush(): Promise<void>
	dispose(): Promise<void>
}

export interface OpenTelemetryAdapterOptions {
	readonly metadata: TelemetryMetadata
	readonly meterProvider?: { getMeter(name: string): unknown; forceFlush?(): Promise<void>; shutdown?(): Promise<void> } | null
	readonly loggerProvider?: {
		getLogger(name: string): { emit(record: Record<string, unknown>): void }
		forceFlush?(): Promise<void>
		shutdown?(): Promise<void>
	} | null
	readonly name?: string
	readonly enabled?: boolean | (() => boolean)
	readonly distinctId?: string
	readonly commonProperties?: TelemetryProperties
	readonly ownsProviders?: boolean
}

/**
 * Behavior-faithful stub of @cline/core's OpenTelemetryAdapter: same enabled
 * gating (`emit` gated, `emitRequired` not) and the same attribute merge order,
 * minus metric instruments and property flattening.
 */
export class OpenTelemetryAdapter implements ITelemetryAdapter {
	readonly name: string
	private readonly metadata: TelemetryMetadata
	private readonly logger: { emit(record: Record<string, unknown>): void } | null
	private readonly enabled: boolean | (() => boolean)
	private readonly ownsProviders: boolean
	private readonly meterProvider?: OpenTelemetryAdapterOptions["meterProvider"]
	private readonly loggerProvider?: OpenTelemetryAdapterOptions["loggerProvider"]
	private distinctId?: string
	private commonProperties: TelemetryProperties

	constructor(options: OpenTelemetryAdapterOptions) {
		this.name = options.name ?? "OpenTelemetryAdapter"
		this.metadata = { ...options.metadata }
		this.meterProvider = options.meterProvider
		this.loggerProvider = options.loggerProvider
		this.logger = options.loggerProvider?.getLogger("cline") ?? null
		this.enabled = options.enabled ?? true
		this.ownsProviders = options.ownsProviders ?? true
		this.distinctId = options.distinctId
		this.commonProperties = { ...(options.commonProperties ?? {}) }
	}

	isEnabled(): boolean {
		return typeof this.enabled === "function" ? this.enabled() : this.enabled
	}

	emit(event: string, properties?: TelemetryProperties): void {
		if (!this.isEnabled()) {
			return
		}
		this.emitLog(event, properties, false)
	}

	emitRequired(event: string, properties?: TelemetryProperties): void {
		this.emitLog(event, properties, true)
	}

	recordCounter(_name: string, _value: number, _attributes?: TelemetryProperties, _description?: string, _required = false) {}
	recordHistogram(_name: string, _value: number, _attributes?: TelemetryProperties, _description?: string, _required = false) {}
	recordGauge(
		_name: string,
		_value: number | null,
		_attributes?: TelemetryProperties,
		_description?: string,
		_required = false,
	) {}

	setDistinctId(distinctId?: string): void {
		this.distinctId = distinctId
	}

	setCommonProperties(properties: TelemetryProperties): void {
		this.commonProperties = { ...properties }
	}

	updateCommonProperties(properties: TelemetryProperties): void {
		this.commonProperties = { ...this.commonProperties, ...properties }
	}

	async flush(): Promise<void> {
		await Promise.all([this.meterProvider?.forceFlush?.(), this.loggerProvider?.forceFlush?.()])
	}

	async dispose(): Promise<void> {
		if (!this.ownsProviders) {
			return
		}
		await Promise.all([this.meterProvider?.shutdown?.(), this.loggerProvider?.shutdown?.()])
	}

	private emitLog(event: string, properties: TelemetryProperties | undefined, required: boolean): void {
		if (!this.logger) {
			return
		}
		this.logger.emit({
			severityText: "INFO",
			body: event,
			attributes: {
				...this.commonProperties,
				...this.metadata,
				...properties,
				...(this.distinctId ? { distinct_id: this.distinctId } : {}),
				...(required ? { _required: true } : {}),
			},
		})
	}
}

export interface TelemetryServiceOptions {
	adapters?: ITelemetryAdapter[]
	metadata?: Partial<TelemetryMetadata>
	distinctId?: string
	deviceId?: string
	commonProperties?: TelemetryProperties
}

/** Behavior-faithful stub of @cline/core's TelemetryService (adapter fan-out + attribute merging). */
export class TelemetryService implements ITelemetryService {
	private adapters: ITelemetryAdapter[]
	private metadata: Partial<TelemetryMetadata>
	private distinctId?: string
	private readonly deviceId: string
	private commonProperties: TelemetryProperties

	constructor(options: TelemetryServiceOptions = {}) {
		this.adapters = [...(options.adapters ?? [])]
		this.metadata = { ...(options.metadata ?? {}) }
		this.distinctId = options.distinctId
		this.deviceId = options.deviceId ?? "stub-core-device-id"
		this.commonProperties = { ...(options.commonProperties ?? {}) }
	}

	setDistinctId(distinctId?: string): void {
		this.distinctId = distinctId
	}

	setMetadata(metadata: Partial<TelemetryMetadata>): void {
		this.metadata = { ...metadata }
	}

	updateMetadata(metadata: Partial<TelemetryMetadata>): void {
		this.metadata = { ...this.metadata, ...metadata }
	}

	setCommonProperties(properties: TelemetryProperties): void {
		this.commonProperties = { ...properties }
	}

	updateCommonProperties(properties: TelemetryProperties): void {
		this.commonProperties = { ...this.commonProperties, ...properties }
	}

	isEnabled(): boolean {
		return this.adapters.some((adapter) => adapter.isEnabled())
	}

	capture(input: { event: string; properties?: TelemetryProperties }): void {
		const properties = this.buildAttributes(input.properties)
		for (const adapter of this.adapters) {
			adapter.emit(input.event, properties)
		}
	}

	captureRequired(event: string, properties?: TelemetryProperties): void {
		const merged = this.buildAttributes(properties)
		for (const adapter of this.adapters) {
			adapter.emitRequired(event, merged)
		}
	}

	recordCounter(name: string, value: number, attributes?: TelemetryProperties, description?: string, required = false): void {
		const merged = this.buildAttributes(attributes)
		for (const adapter of this.adapters) {
			adapter.recordCounter(name, value, merged, description, required)
		}
	}

	recordHistogram(name: string, value: number, attributes?: TelemetryProperties, description?: string, required = false): void {
		const merged = this.buildAttributes(attributes)
		for (const adapter of this.adapters) {
			adapter.recordHistogram(name, value, merged, description, required)
		}
	}

	recordGauge(
		name: string,
		value: number | null,
		attributes?: TelemetryProperties,
		description?: string,
		required = false,
	): void {
		const merged = this.buildAttributes(attributes)
		for (const adapter of this.adapters) {
			adapter.recordGauge(name, value, merged, description, required)
		}
	}

	async flush(): Promise<void> {
		await Promise.all(this.adapters.map((adapter) => adapter.flush()))
	}

	async dispose(): Promise<void> {
		await Promise.all(this.adapters.map((adapter) => adapter.dispose()))
	}

	private buildAttributes(properties?: TelemetryProperties): TelemetryProperties {
		return {
			...this.commonProperties,
			...properties,
			...this.metadata,
			...(this.distinctId ? { distinct_id: this.distinctId } : {}),
			device_id: this.deviceId,
		}
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

const WORKOS_TOKEN_PREFIX = "workos:"

export function getProviderAuthStorageId(providerId: string): string | undefined {
	const normalized = providerId.trim().toLowerCase()
	if (normalized === "cline" || normalized === "cline-pass") {
		return "cline"
	}
	if (normalized === "oca" || normalized === "openai-codex") {
		return normalized
	}
	return undefined
}

function formatClineApiKey(accessToken: string): string {
	const token = accessToken.trim()
	return token.toLowerCase().startsWith(WORKOS_TOKEN_PREFIX) ? token : `${WORKOS_TOKEN_PREFIX}${token}`
}

export function getProviderAuthHandler(providerId: string) {
	const storageProviderId = getProviderAuthStorageId(providerId)
	if (!storageProviderId) {
		return undefined
	}
	return {
		providerId,
		storageProviderId,
		getApiKey(settings: Record<string, unknown> | undefined): string | undefined {
			const auth = settings?.auth as { accessToken?: string; apiKey?: string } | undefined
			const accessToken = auth?.accessToken?.trim()
			if (accessToken) {
				return storageProviderId === "cline" ? formatClineApiKey(accessToken) : accessToken
			}
			return (settings?.apiKey as string | undefined)?.trim() || auth?.apiKey?.trim() || undefined
		},
	}
}

export function resolveProviderApiKeyFromSettings(manager: ProviderSettingsManager, providerId: string): string | undefined {
	const handler = getProviderAuthHandler(providerId)
	const storageProviderId = handler?.storageProviderId ?? providerId
	const settings = manager.getProviderSettings(storageProviderId)
	return handler?.getApiKey(settings) ?? ((settings?.apiKey as string | undefined)?.trim() || undefined)
}

export interface ModelCatalogConfig {
	loadLatestOnInit?: boolean
	loadPrivateOnAuth?: boolean
	failOnError?: boolean
	cacheTtlMs?: number
}

function titleCaseFromId(id: string): string {
	return id
		.split(/[-_]/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ")
}

export async function listLocalProviders(
	manager: ProviderSettingsManager,
	options: { isClinePassEnabled?: boolean } = {},
): Promise<{ providers: Array<Record<string, unknown>>; settingsPath: string }> {
	const state = manager.read()
	const providers = Object.entries(MODEL_COLLECTIONS_BY_PROVIDER_ID)
		.map(([id, collection]) => {
			const settings = state.providers[id]?.settings as Record<string, unknown> | undefined
			const provider = collection.provider
			return {
				id,
				name: provider.name ?? titleCaseFromId(id),
				models: Object.keys(collection.models ?? {}).length,
				enabled: Boolean(settings),
				apiKey: settings?.apiKey,
				baseUrl: settings?.baseUrl ?? provider.baseUrl,
				defaultModelId: provider.defaultModelId,
				protocol: settings?.protocol ?? provider.protocol,
				client: settings?.client ?? provider.client,
				capabilities: provider.capabilities,
				authDescription: "This provider uses API keys for authentication.",
				baseUrlDescription: "The base endpoint to use for provider requests.",
			}
		})
		.filter((provider) => options.isClinePassEnabled === true || provider.id !== "cline-pass")
		.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))

	return { providers, settingsPath: manager.getFilePath() }
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

export const FALLBACK_CLINE_RECOMMENDED_MODELS: ClineRecommendedModelsData = {
	recommended: [
		{
			id: "anthropic/claude-sonnet-4.6",
			name: "Claude Sonnet 4.6",
			description: "Strong coding and agent performance",
			tags: ["NEW"],
		},
	],
	free: [
		{
			id: "z-ai/glm-5",
			name: "GLM 5",
			description: "Remote free",
			tags: [],
		},
	],
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

import { readFileSync, writeFileSync } from "node:fs"
import { getGeneratedModelsForProvider, MODEL_COLLECTIONS_BY_PROVIDER_ID } from "@cline/llms"

export interface OAuthCredentials {
	accessToken?: string
	refreshToken?: string
	accountId?: string
}

export interface StartSessionResult {
	sessionId: string
}

export const MAX_COMMAND_OUTPUT_CHARS = 200_000

export type GlobalCompactionStrategy = "basic" | "agentic"

export function readCompactionStrategyGlobally(): GlobalCompactionStrategy {
	try {
		const settings = JSON.parse(readFileSync(process.env.CLINE_GLOBAL_SETTINGS_PATH ?? "", "utf8"))
		return settings.compactionStrategy === "agentic" ? "agentic" : "basic"
	} catch {
		return "basic"
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

export function createShellExecutor() {
	return async () => ""
}

// Real (dependency-light) edit-executor implementations, re-exported from the sdk source so
// the diff-edit coordinator and its tests exercise the actual content/parse semantics. These
// modules only pull in node:fs/node:path and the patch parser — not the heavy core runtime.
export {
	computePatchChanges,
	createApplyPatchExecutor,
	type PatchFileChange,
} from "../../../../sdk/packages/core/src/extensions/tools/executors/apply-patch"
export { PatchActionType } from "../../../../sdk/packages/core/src/extensions/tools/executors/apply-patch-parser"
export { createEditorExecutor } from "../../../../sdk/packages/core/src/extensions/tools/executors/editor"
export type { EditFileInput } from "../../../../sdk/packages/core/src/extensions/tools/schemas"
export type { ApplyPatchExecutor, EditorExecutor } from "../../../../sdk/packages/core/src/extensions/tools/types"

export function createShellTool(execute: unknown) {
	return {
		name: "run_commands",
		execute,
	}
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

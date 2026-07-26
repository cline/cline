import { readFileSync, writeFileSync } from "node:fs"
import { MODEL_COLLECTIONS_BY_PROVIDER_ID } from "@cline/llms"

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
export { PatchActionType } from "../../../../sdk/packages/core/src/extensions/tools/executors/apply-patch-parser"
export { createEditorExecutor } from "../../../../sdk/packages/core/src/extensions/tools/executors/editor"
export type { EditFileInput } from "../../../../sdk/packages/core/src/extensions/tools/schemas"
export type { ApplyPatchExecutor, EditorExecutor } from "../../../../sdk/packages/core/src/extensions/tools/types"

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
	const collection = MODEL_COLLECTIONS_BY_PROVIDER_ID[providerId]
	const knownModels = collection?.models ?? {}
	const requestedModelId = providerConfig?.modelId?.trim()
	const manifestDefaultModelId = collection?.provider.defaultModelId
	const defaultModelId =
		manifestDefaultModelId && knownModels[manifestDefaultModelId]
			? manifestDefaultModelId
			: Object.keys(knownModels)[0] || Object.keys(collection?.models ?? {})[0]
	const modelId = requestedModelId && knownModels[requestedModelId] ? requestedModelId : defaultModelId
	return { modelId, knownModels }
}

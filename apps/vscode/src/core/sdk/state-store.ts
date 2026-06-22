// Owns the extension's persisted view-model: apiConfiguration, mode, taskHistory, and the
// settings the webview reads. Backed by VSCode context.globalState (and context.secrets for API
// keys) when available, falling back to an in-memory store so construction never throws during
// activation. The buildExtensionState() method assembles a VALID ExtensionState with sensible
// defaults for every required field the webview contract expects.

import type { ApiConfiguration } from "@shared/api"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import type { ClineMessage, ExtensionState, Platform, TurnState } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import { DEFAULT_MCP_DISPLAY_MODE } from "@shared/McpDisplayMode"
import type { Mode } from "@shared/storage/types"
import type { ClineExtensionContext } from "@/shared/cline"

/** Minimal VSCode Memento shape (context.globalState). */
interface MementoLike {
	get<T>(key: string): T | undefined
	update(key: string, value: unknown): Thenable<void>
}

/** Minimal VSCode SecretStorage shape (context.secrets). */
interface SecretStorageLike {
	get(key: string): Thenable<string | undefined>
	store(key: string, value: string): Thenable<void>
	delete(key: string): Thenable<void>
}

const GLOBAL_KEY_API_CONFIG = "cline.sdk.apiConfiguration"
const GLOBAL_KEY_MODE = "cline.sdk.mode"
const GLOBAL_KEY_TASK_HISTORY = "cline.sdk.taskHistory"
const GLOBAL_KEY_SETTINGS = "cline.sdk.settings"

/** Settings the store tracks beyond the dedicated apiConfiguration/mode/taskHistory. */
export interface StoredSettings {
	telemetrySetting?: ExtensionState["telemetrySetting"]
	preferredLanguage?: string
	planActSeparateModelsSetting?: boolean
	enableCheckpointsSetting?: boolean
	mcpMarketplaceEnabled?: boolean
	shellIntegrationTimeout?: number
	terminalOutputLineLimit?: number
	maxConsecutiveMistakes?: number
	customPrompt?: string
	favoritedModelIds?: string[]
	useAutoCondense?: boolean
	subagentsEnabled?: boolean
}

function extractMemento(context: ClineExtensionContext): MementoLike | undefined {
	const candidate = (context as unknown as { globalState?: unknown }).globalState
	if (candidate && typeof (candidate as MementoLike).get === "function") {
		return candidate as MementoLike
	}
	return undefined
}

function extractSecrets(context: ClineExtensionContext): SecretStorageLike | undefined {
	const candidate = (context as unknown as { secrets?: unknown }).secrets
	if (candidate && typeof (candidate as SecretStorageLike).get === "function") {
		return candidate as SecretStorageLike
	}
	return undefined
}

export class ExtensionStateStore {
	private readonly memento?: MementoLike
	private readonly secrets?: SecretStorageLike
	private readonly fallback = new Map<string, unknown>()

	private apiConfiguration: ApiConfiguration
	private mode: Mode
	private taskHistory: HistoryItem[]
	private settings: StoredSettings
	private version: string

	constructor(context: ClineExtensionContext, version = "0.0.0") {
		this.memento = extractMemento(context)
		this.secrets = extractSecrets(context)
		this.version = version

		this.apiConfiguration = this.readGlobal<ApiConfiguration>(GLOBAL_KEY_API_CONFIG) ?? {}
		this.mode = this.readGlobal<Mode>(GLOBAL_KEY_MODE) ?? "act"
		this.taskHistory = this.readGlobal<HistoryItem[]>(GLOBAL_KEY_TASK_HISTORY) ?? []
		this.settings = this.readGlobal<StoredSettings>(GLOBAL_KEY_SETTINGS) ?? {}
	}

	private readGlobal<T>(key: string): T | undefined {
		if (this.memento) {
			return this.memento.get<T>(key)
		}
		return this.fallback.get(key) as T | undefined
	}

	private writeGlobal(key: string, value: unknown): void {
		this.fallback.set(key, value)
		// Fire-and-forget; persistence failures must not break the request path.
		void this.memento?.update(key, value)
	}

	// ---- apiConfiguration ----

	getApiConfiguration(): ApiConfiguration {
		return this.apiConfiguration
	}

	setApiConfiguration(partial: Partial<ApiConfiguration>): void {
		this.apiConfiguration = { ...this.apiConfiguration, ...partial }
		this.writeGlobal(GLOBAL_KEY_API_CONFIG, this.apiConfiguration)
	}

	/** Persist a secret API key keyed by field name (uses context.secrets when available). */
	async setSecret(key: string, value: string | undefined): Promise<void> {
		if (!this.secrets) {
			return
		}
		if (value) {
			await this.secrets.store(key, value)
		} else {
			await this.secrets.delete(key)
		}
	}

	async getSecret(key: string): Promise<string | undefined> {
		return this.secrets?.get(key)
	}

	// ---- mode ----

	getMode(): Mode {
		return this.mode
	}

	setMode(mode: Mode): void {
		this.mode = mode
		this.writeGlobal(GLOBAL_KEY_MODE, mode)
	}

	// ---- taskHistory ----

	getTaskHistory(): HistoryItem[] {
		return this.taskHistory
	}

	setTaskHistory(history: HistoryItem[]): void {
		this.taskHistory = history
		this.writeGlobal(GLOBAL_KEY_TASK_HISTORY, history)
	}

	upsertTaskHistoryItem(item: HistoryItem): void {
		const next = [...this.taskHistory]
		const index = next.findIndex((h) => h.id === item.id)
		if (index >= 0) {
			next[index] = item
		} else {
			next.unshift(item)
		}
		this.setTaskHistory(next)
	}

	// ---- settings ----

	getSettings(): StoredSettings {
		return this.settings
	}

	setSettings(partial: Partial<StoredSettings>): void {
		this.settings = { ...this.settings, ...partial }
		this.writeGlobal(GLOBAL_KEY_SETTINGS, this.settings)
	}

	// ---- ExtensionState assembly ----

	/**
	 * Build a complete, valid ExtensionState. `clineMessages` is the live transcript and
	 * `turnState` is the authoritative UI-mode for the current turn (both owned by the
	 * Controller). Every required field is filled with a sensible default so the webview never
	 * sees an undefined required key.
	 */
	buildExtensionState(clineMessages: ClineMessage[], turnState?: TurnState): ExtensionState {
		const s = this.settings
		const currentTaskItem = clineMessages.length > 0 ? this.taskHistory[0] : undefined
		return {
			version: this.version,
			isNewUser: false,
			welcomeViewCompleted: true,
			onboardingModels: undefined,
			apiConfiguration: this.apiConfiguration,
			autoApprovalSettings: DEFAULT_AUTO_APPROVAL_SETTINGS,
			browserSettings: DEFAULT_BROWSER_SETTINGS,
			preferredLanguage: s.preferredLanguage,
			mode: this.mode,
			clineMessages,
			turnState,
			currentTaskItem,
			mcpMarketplaceEnabled: s.mcpMarketplaceEnabled ?? false,
			mcpDisplayMode: DEFAULT_MCP_DISPLAY_MODE,
			planActSeparateModelsSetting: s.planActSeparateModelsSetting ?? false,
			enableCheckpointsSetting: s.enableCheckpointsSetting ?? false,
			platform: process.platform as Platform,
			shouldShowAnnouncement: false,
			taskHistory: this.taskHistory,
			telemetrySetting: s.telemetrySetting ?? "unset",
			shellIntegrationTimeout: s.shellIntegrationTimeout ?? 4000,
			terminalOutputLineLimit: s.terminalOutputLineLimit ?? 500,
			maxConsecutiveMistakes: s.maxConsecutiveMistakes ?? 3,
			vscodeTerminalExecutionMode: "default",
			distinctId: "",
			globalClineRulesToggles: {},
			localClineRulesToggles: {},
			localWorkflowToggles: {},
			globalWorkflowToggles: {},
			localCursorRulesToggles: {},
			localWindsurfRulesToggles: {},
			localAgentsRulesToggles: {},
			customPrompt: s.customPrompt,
			favoritedModelIds: s.favoritedModelIds ?? [],
			useAutoCondense: s.useAutoCondense ?? false,
			subagentsEnabled: s.subagentsEnabled ?? false,
			workspaceRoots: [],
			primaryRootIndex: 0,
			isMultiRootWorkspace: false,
			multiRootSetting: { user: false, featureFlag: false },
			lastDismissedInfoBannerVersion: 0,
			lastDismissedModelBannerVersion: 0,
			lastDismissedCliBannerVersion: 0,
		}
	}
}

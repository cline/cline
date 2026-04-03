/**
 * Legacy State Reader
 *
 * Reads the existing on-disk state from ~/.cline/data/ without depending on
 * VSCode, StateManager, or any other extension infrastructure.
 *
 * This is used by the SDK adapter layer to bootstrap from existing user data
 * (provider credentials, settings, task history, per-task messages, etc.)
 * so that the SDK migration is transparent to users.
 *
 * File layout it reads:
 *   ~/.cline/data/globalState.json        — settings, provider config, UI state
 *   ~/.cline/data/secrets.json            — API keys (mode 0o600)
 *   ~/.cline/data/state/taskHistory.json  — task history array
 *   ~/.cline/data/tasks/<id>/             — per-task files
 *     api_conversation_history.json       — API messages
 *     ui_messages.json                    — UI messages (ClineMessage[])
 */

import * as fs from "node:fs"
import * as path from "node:path"

import type { HistoryItem } from "@shared/HistoryItem"
import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import type { Mode } from "@shared/storage/types"
import type { SecretKey } from "@shared/storage/state-keys"
import { ApiHandlerSettingsKeys, SecretKeys } from "@shared/storage/state-keys"
import type { ApiConfiguration } from "@shared/api"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The subset of globalState.json we care about for SDK bootstrapping. */
export interface LegacyGlobalState {
	// Provider / model
	apiProvider?: string
	apiModelId?: string

	// Mode
	mode?: Mode

	// Per-mode provider/model overrides
	planModeApiProvider?: string
	planModeApiModelId?: string
	actModeApiProvider?: string
	actModeApiModelId?: string
	planActSeparateModelsSetting?: boolean

	// Custom instructions
	customInstructions?: string

	// Auto-approval (legacy top-level booleans)
	alwaysAllowReadOnly?: boolean
	alwaysAllowWrite?: boolean
	alwaysAllowExecute?: boolean
	alwaysAllowBrowser?: boolean
	alwaysAllowMcp?: boolean
	alwaysAllowModeSwitch?: boolean

	// Structured auto-approval
	autoApprovalSettings?: AutoApprovalSettings

	// Auto-condense
	autoCondenseContext?: boolean
	autoCondenseContextPercent?: number

	// Task history (legacy location — may still be in globalState for old installs)
	taskHistory?: HistoryItem[]

	// Telemetry
	telemetrySetting?: string

	// User info
	userInfo?: { displayName?: string; email?: string; plan?: string }

	// Any other keys (we preserve them for round-tripping)
	[key: string]: unknown
}

/** A map of secret key → value. */
export type LegacySecrets = Partial<Record<SecretKey, string>>

/** Options for constructing a LegacyStateReader. */
export interface LegacyStateReaderOptions {
	/** Override the data directory. Defaults to ~/.cline/data */
	dataDir?: string
	/** Override the cline home directory. Defaults to CLINE_DIR env var or ~/.cline */
	clineDir?: string
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class LegacyStateReader {
	readonly dataDir: string

	constructor(opts: LegacyStateReaderOptions = {}) {
		if (opts.dataDir) {
			this.dataDir = opts.dataDir
		} else {
			const clineDir =
				opts.clineDir || process.env.CLINE_DIR || path.join(require("os").homedir(), ".cline")
			this.dataDir = path.join(clineDir, "data")
		}
	}

	// -----------------------------------------------------------------------
	// Global state
	// -----------------------------------------------------------------------

	/** Read and parse globalState.json. Returns empty object on missing/corrupt file. */
	readGlobalState(): LegacyGlobalState {
		return this.readJsonFile<LegacyGlobalState>(path.join(this.dataDir, "globalState.json")) ?? {}
	}

	// -----------------------------------------------------------------------
	// Secrets
	// -----------------------------------------------------------------------

	/** Read and parse secrets.json. Returns empty object on missing/corrupt file. */
	readSecrets(): LegacySecrets {
		return this.readJsonFile<LegacySecrets>(path.join(this.dataDir, "secrets.json")) ?? {}
	}

	// -----------------------------------------------------------------------
	// Task history
	// -----------------------------------------------------------------------

	/**
	 * Read the task history. Checks the canonical location first
	 * (~/.cline/data/state/taskHistory.json), then falls back to the
	 * legacy location inside globalState.json.
	 */
	readTaskHistory(): HistoryItem[] {
		// Canonical location (post-migration)
		const stateFile = path.join(this.dataDir, "state", "taskHistory.json")
		const fromFile = this.readJsonFile<HistoryItem[]>(stateFile)
		if (Array.isArray(fromFile) && fromFile.length > 0) {
			return fromFile
		}

		// Fallback: legacy location in globalState.json
		const gs = this.readGlobalState()
		if (Array.isArray(gs.taskHistory) && gs.taskHistory.length > 0) {
			return gs.taskHistory
		}

		return []
	}

	// -----------------------------------------------------------------------
	// Per-task data
	// -----------------------------------------------------------------------

	/** Read the API conversation history for a task. */
	readApiConversationHistory(taskId: string): unknown[] {
		const filePath = path.join(this.dataDir, "tasks", taskId, "api_conversation_history.json")
		return this.readJsonFile<unknown[]>(filePath) ?? []
	}

	/** Read the UI messages (ClineMessage[]) for a task. */
	readUiMessages(taskId: string): unknown[] {
		const filePath = path.join(this.dataDir, "tasks", taskId, "ui_messages.json")
		const result = this.readJsonFile<unknown[]>(filePath)
		if (Array.isArray(result)) {
			return result
		}

		// Check old location (claude_messages.json)
		const oldPath = path.join(this.dataDir, "tasks", taskId, "claude_messages.json")
		return this.readJsonFile<unknown[]>(oldPath) ?? []
	}

	/** Check if a task directory exists. */
	taskExists(taskId: string): boolean {
		const taskDir = path.join(this.dataDir, "tasks", taskId)
		try {
			return fs.existsSync(taskDir) && fs.statSync(taskDir).isDirectory()
		} catch {
			return false
		}
	}

	/** List all task IDs that have directories on disk. */
	listTaskIds(): string[] {
		const tasksDir = path.join(this.dataDir, "tasks")
		try {
			if (!fs.existsSync(tasksDir)) {
				return []
			}
			return fs
				.readdirSync(tasksDir)
				.filter((entry) => {
					try {
						return fs.statSync(path.join(tasksDir, entry)).isDirectory()
					} catch {
						return false
					}
				})
				.sort()
		} catch {
			return []
		}
	}

	// -----------------------------------------------------------------------
	// Auto-approval settings
	// -----------------------------------------------------------------------

	/**
	 * Read auto-approval settings, merging structured settings with
	 * legacy top-level boolean flags for backward compatibility.
	 */
	readAutoApprovalSettings(): AutoApprovalSettings {
		const gs = this.readGlobalState()

		// Start with defaults
		const result: AutoApprovalSettings = { ...DEFAULT_AUTO_APPROVAL_SETTINGS }

		// Apply structured settings if present
		if (gs.autoApprovalSettings && typeof gs.autoApprovalSettings === "object") {
			const s = gs.autoApprovalSettings
			if (typeof s.version === "number") result.version = s.version
			if (typeof s.enabled === "boolean") result.enabled = s.enabled
			if (typeof s.enableNotifications === "boolean") result.enableNotifications = s.enableNotifications
			if (typeof s.maxRequests === "number") result.maxRequests = s.maxRequests
			if (Array.isArray(s.favorites)) result.favorites = s.favorites
			if (s.actions && typeof s.actions === "object") {
				result.actions = { ...result.actions, ...s.actions }
			}
		}

		// Legacy top-level booleans override structured settings
		if (typeof gs.alwaysAllowReadOnly === "boolean") {
			result.actions.readFiles = gs.alwaysAllowReadOnly
		}
		if (typeof gs.alwaysAllowWrite === "boolean") {
			result.actions.editFiles = gs.alwaysAllowWrite
		}
		if (typeof gs.alwaysAllowBrowser === "boolean") {
			result.actions.useBrowser = gs.alwaysAllowBrowser
		}
		if (typeof gs.alwaysAllowMcp === "boolean") {
			result.actions.useMcp = gs.alwaysAllowMcp
		}

		return result
	}

	// -----------------------------------------------------------------------
	// Convenience: provider info
	// -----------------------------------------------------------------------

	/** Get the current provider ID from global state. */
	getProvider(): string {
		const gs = this.readGlobalState()
		return gs.apiProvider ?? "anthropic"
	}

	/** Get the current model ID from global state. */
	getModelId(): string | undefined {
		const gs = this.readGlobalState()
		return gs.apiModelId ?? undefined
	}

	/** Get the API key for a given secret key. */
	getSecret(key: SecretKey): string | undefined {
		const secrets = this.readSecrets()
		return secrets[key]
	}

	/** Get the current mode (plan or act). */
	getMode(): Mode {
		const gs = this.readGlobalState()
		return gs.mode === "plan" ? "plan" : "act"
	}

	/** Get custom instructions. */
	getCustomInstructions(): string | undefined {
		const gs = this.readGlobalState()
		return gs.customInstructions ?? undefined
	}

	// -----------------------------------------------------------------------
	// ApiConfiguration builder
	// -----------------------------------------------------------------------

	/**
	 * Build a complete ApiConfiguration from flat globalState keys + secrets.
	 *
	 * This replicates what StateManager.constructApiConfigurationFromCache() does
	 * in the classic extension: it reads all ApiHandlerSettings keys from
	 * globalState.json and all secret keys from secrets.json, then merges them
	 * into a single ApiConfiguration object.
	 *
	 * The webview expects this flat structure with keys like:
	 *   actModeApiProvider, actModeClineModelId, planModeApiProvider,
	 *   clineApiKey, openRouterApiKey, etc.
	 */
	buildApiConfiguration(): ApiConfiguration {
		const gs = this.readGlobalState()
		const secretsData = this.readSecrets()

		const config: Record<string, unknown> = {}

		// 1. Copy all ApiHandlerSettings keys from globalState
		for (const key of ApiHandlerSettingsKeys) {
			const value = (gs as Record<string, unknown>)[key]
			if (value !== undefined) {
				config[key] = value
			}
		}

		// 2. Copy all secret keys from secrets.json
		for (const key of SecretKeys) {
			const value = secretsData[key as SecretKey]
			if (value !== undefined) {
				config[key] = value
			}
		}

		// 3. Apply computed defaults: ensure mode providers default to "openrouter"
		//    (matches handleComputedProperties in state-helpers.ts)
		if (!config.planModeApiProvider) {
			config.planModeApiProvider = "openrouter"
		}
		if (!config.actModeApiProvider) {
			config.actModeApiProvider = "openrouter"
		}

		return config as ApiConfiguration
	}

	// -----------------------------------------------------------------------
	// MCP settings
	// -----------------------------------------------------------------------

	/** Read MCP server settings from the settings directory. */
	readMcpSettings(): Record<string, unknown> | null {
		const filePath = path.join(this.dataDir, "settings", "cline_mcp_settings.json")
		return this.readJsonFile<Record<string, unknown>>(filePath)
	}

	// -----------------------------------------------------------------------
	// Internals
	// -----------------------------------------------------------------------

	/**
	 * Safely read and parse a JSON file. Returns null on any error
	 * (missing file, permission error, corrupt JSON).
	 */
	private readJsonFile<T>(filePath: string): T | null {
		try {
			if (!fs.existsSync(filePath)) {
				return null
			}
			const raw = fs.readFileSync(filePath, "utf-8")
			return JSON.parse(raw) as T
		} catch {
			// Missing, unreadable, or corrupt — all handled the same way
			return null
		}
	}
}

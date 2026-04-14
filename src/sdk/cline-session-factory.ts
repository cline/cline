// Replaces classic task creation from src/core/task/index.ts (see origin/main)
//
// Creates and manages SDK sessions using ClineCore. This factory handles:
// - Creating ClineCore instances with proper configuration
// - Building session config from legacy state (provider, model, API key)
// - Custom session persistence adapter reading ~/.cline/data/tasks/
// - Mapping HistoryItem ↔ SDK session fields
//
// The factory does NOT handle UI concerns — that's the SdkController's job.

import { ClineCore, type CoreSessionConfig, type StartSessionInput, type StartSessionResult } from "@clinebot/core"
import type { HistoryItem } from "@shared/HistoryItem"
import { Logger } from "@shared/services/Logger"
import type { Settings } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import { StateManager } from "@/core/storage/StateManager"
import { readTaskHistory, resolveDataDir } from "./legacy-state-reader"
import { getProviderSettingsManager } from "./provider-migration"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for creating a new session */
export interface SessionConfigInput {
	/** The user's prompt */
	prompt?: string
	/** Images attached to the message */
	images?: string[]
	/** Files attached to the message */
	files?: string[]
	/** History item to resume (for task resumption) */
	historyItem?: HistoryItem
	/** Task-specific settings overrides */
	taskSettings?: Partial<Settings>
	/** Working directory */
	cwd: string
	/** Workspace root */
	workspaceRoot?: string
	/** Current mode (act/plan) */
	mode?: Mode
}

/** Active session state tracked by the factory */
export interface ActiveSession {
	/** The session ID */
	sessionId: string
	/** The ClineCore instance managing this session */
	core: ClineCore
	/** Unsubscribe function for session events */
	unsubscribe: () => void
	/** The start result from the session */
	startResult?: StartSessionResult
	/** Whether the session is currently running */
	isRunning: boolean
}

// ---------------------------------------------------------------------------
// Session config builder
// ---------------------------------------------------------------------------

/**
 * Build a CoreSessionConfig from the current state.
 *
 * Reads provider settings from the SDK's ProviderSettingsManager first,
 * then falls back to the classic StateManager (globalState.json) if the
 * SDK manager doesn't have a valid provider configured. This fallback is
 * critical because the SDK's providers.json may not exist yet or may not
 * have been populated with the user's credentials.
 */
export async function buildSessionConfig(input: SessionConfigInput): Promise<CoreSessionConfig> {
	const cwd = input.cwd || process.cwd()
	const workspaceRoot = input.workspaceRoot ?? cwd

	// Try SDK's ProviderSettingsManager first
	let providerId: string | undefined
	let modelId: string | undefined
	let apiKey: string | undefined
	let baseUrl: string | undefined

	try {
		const dataDir = resolveDataDir()
		const manager = getProviderSettingsManager(dataDir)
		const lastUsed = manager.getLastUsedProviderSettings()

		if (lastUsed?.provider && lastUsed?.apiKey) {
			providerId = lastUsed.provider
			modelId = lastUsed.model
			apiKey = lastUsed.apiKey
			baseUrl = lastUsed.baseUrl
			Logger.log(`[SessionFactory] Using SDK provider: ${providerId}/${modelId}`)
		}
	} catch (error) {
		Logger.warn("[SessionFactory] SDK ProviderSettingsManager not available, falling back to StateManager:", error)
	}

	// Fallback: read from classic StateManager (globalState.json + secrets.json)
	// Uses the existing buildApiHandlerSettings() which correctly resolves
	// provider/model/apiKey for the current mode (plan/act).
	if (!providerId || !apiKey) {
		try {
			const stateManager = StateManager.get()
			const mode = input.mode ?? "act"
			const apiSettings = stateManager.buildApiHandlerSettings(mode)

			if (apiSettings.apiProvider) {
				providerId = apiSettings.apiProvider
				modelId = apiSettings.apiModelId ?? undefined
				apiKey = (apiSettings[`${apiSettings.apiProvider}ApiKey` as keyof typeof apiSettings] as string) ?? undefined
				baseUrl = (apiSettings[`${apiSettings.apiProvider}BaseUrl` as keyof typeof apiSettings] as string) ?? undefined

				Logger.log(`[SessionFactory] Using classic StateManager provider: ${providerId}/${modelId}`)
			}
		} catch (error) {
			Logger.warn("[SessionFactory] Classic StateManager fallback failed:", error)
		}
	}

	// Final defaults
	providerId = providerId ?? "anthropic"
	modelId = modelId ?? "claude-sonnet-4-6"
	apiKey = apiKey ?? ""

	const config: CoreSessionConfig = {
		providerId,
		modelId,
		apiKey,
		baseUrl,
		cwd,
		workspaceRoot,
		systemPrompt: "", // Will be resolved by the SDK's prompt builder
		enableTools: true,
		enableSpawnAgent: input.taskSettings?.subagentsEnabled ?? false,
		enableAgentTeams: false,
		mode: input.mode === "plan" ? "plan" : "act",
		thinking: false,
		maxIterations: undefined,
	}

	return config
}

// ---------------------------------------------------------------------------
// Session factory
// ---------------------------------------------------------------------------

/**
 * Create a ClineCore instance for managing sessions.
 *
 * The ClineCore instance is the primary entry point for the SDK's
 * session management. It handles creating, sending, aborting, and
 * subscribing to sessions.
 */
export async function createClineCore(): Promise<ClineCore> {
	const core = await ClineCore.create({
		clientName: "cline-vscode",
		backendMode: "local",
	})

	Logger.log("[SessionFactory] ClineCore instance created")
	return core
}

/**
 * Build the StartSessionInput for a new task.
 */
export function buildStartSessionInput(config: CoreSessionConfig, input: SessionConfigInput): StartSessionInput {
	return {
		config,
		prompt: input.prompt,
		interactive: true, // VSCode extension always uses interactive mode
		userImages: input.images,
		userFiles: input.files,
	}
}

/**
 * Build the StartSessionInput for resuming an existing task.
 *
 * When resuming, we don't pass initialMessages — the SDK's session
 * persistence handles loading the conversation history from disk.
 */
export function buildResumeSessionInput(
	sessionId: string,
	prompt: string,
	images?: string[],
	files?: string[],
): { sessionId: string; prompt: string; userImages?: string[]; userFiles?: string[] } {
	return {
		sessionId,
		prompt,
		userImages: images,
		userFiles: files,
	}
}

// ---------------------------------------------------------------------------
// Task history helpers
// ---------------------------------------------------------------------------

/**
 * Get a HistoryItem by ID from the task history.
 */
export function getHistoryItemById(taskId: string, dataDir?: string): HistoryItem | undefined {
	const history = readTaskHistory(dataDir)
	return history.find((item) => item.id === taskId)
}

/**
 * Update a HistoryItem in the task history.
 * Returns the updated history array.
 */
export function updateHistoryItem(item: HistoryItem, dataDir?: string): HistoryItem[] {
	// This will be properly implemented when we wire up the gRPC handlers
	// in Step 5. For now, we read the history, update the item, and return it.
	const history = readTaskHistory(dataDir)
	const index = history.findIndex((h) => h.id === item.id)
	if (index >= 0) {
		history[index] = item
	} else {
		history.unshift(item)
	}
	return history
}

/**
 * Create a new HistoryItem from a session start result.
 */
export function createHistoryItemFromSession(sessionId: string, prompt: string, modelId?: string, cwd?: string): HistoryItem {
	return {
		id: sessionId,
		ts: Date.now(),
		task: prompt,
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		modelId,
		cwdOnTaskInitialization: cwd,
	}
}

// Replaces classic task creation from src/core/task/index.ts (see origin/main)
//
// Creates and manages SDK sessions using ClineCore. This factory handles:
// - Creating ClineCore instances with proper configuration
// - Building session config from legacy state (provider, model, API key)
// - Custom session persistence adapter reading ~/.cline/data/tasks/
// - Mapping HistoryItem ↔ SDK session fields
//
// The factory does NOT handle UI concerns — that's the SdkController's job.

import { type ClineCoreStartInput, type CoreSessionConfig, type SessionHost, type StartSessionResult } from "@clinebot/core"
import { buildClineSystemPrompt } from "@clinebot/shared"
import type { ApiConfiguration } from "@shared/api"
import type { HistoryItem } from "@shared/HistoryItem"
import { Logger } from "@shared/services/Logger"
import type { Settings } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import { StateManager } from "@/core/storage/StateManager"
import { ExtensionRegistryInfo } from "@/registry"
import { getDistinctId } from "@/services/logging/distinctId"
import { buildAgentHooks } from "./hooks-adapter"
import { readTaskHistory, resolveDataDir } from "./legacy-state-reader"
import { getProviderSettingsManager } from "./provider-migration"

// ---------------------------------------------------------------------------
// Plan mode instructions
// ---------------------------------------------------------------------------

/**
 * Instructions appended to the system prompt when the session is in plan mode.
 * Mirrors the CLI's plan-mode guardrails in apps/cli/src/runtime/prompt.ts so
 * plan mode in VSCode has the same explicit "explore/analyze/plan, do not
 * implement" guidance.
 */
const PLAN_MODE_INSTRUCTIONS = `# Plan Mode

You are in Plan mode. Your role is to explore, analyze, and plan -- not to execute.

- Read files, search the codebase, and gather context to understand the problem
- Ask clarifying questions when requirements are ambiguous
- Present your plan as a structured outline with clear steps
- Explain tradeoffs between different approaches when they exist
- Do NOT edit files, write code, run destructive commands, or make any changes
- Do NOT implement anything -- focus on understanding and alignment first

When the user aligns on a plan and is ready to proceed, use the switch_to_act_mode tool to switch to act mode and begin implementation.`

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
	/** The runtime host instance managing this session (VscodeSessionHost) */
	sessionManager: SessionHost
	/** Unsubscribe function for session events */
	unsubscribe: () => void
	/** The start result from the session */
	startResult?: StartSessionResult
	/** Whether the session is currently running */
	isRunning: boolean
}

function createSdkLogger() {
	return {
		debug: (message: string, metadata?: Record<string, unknown>) => {
			Logger.debug(message, metadata)
		},
		log: (message: string, metadata?: Record<string, unknown>) => {
			Logger.log(message, metadata)
		},
		error: (message: string, metadata?: Record<string, unknown>) => {
			Logger.error(message, metadata)
		},
	}
}

// ---------------------------------------------------------------------------
// Provider → API key field mapping
// ---------------------------------------------------------------------------

/**
 * Maps a provider ID to the corresponding API key field name in ApiConfiguration.
 * This covers all 30+ providers supported by the classic extension.
 */
const PROVIDER_API_KEY_MAP: Record<string, keyof ApiConfiguration> = {
	anthropic: "apiKey",
	openrouter: "openRouterApiKey",
	openai: "openAiApiKey",
	"openai-native": "openAiNativeApiKey",
	"openai-codex": "openAiNativeApiKey", // Codex uses the same key
	bedrock: "awsBedrockApiKey",
	vertex: "geminiApiKey",
	gemini: "geminiApiKey",
	deepseek: "deepSeekApiKey",
	ollama: "ollamaApiKey",
	lmstudio: "apiKey", // LM Studio doesn't need a key but uses the generic field
	requesty: "requestyApiKey",
	together: "togetherApiKey",
	fireworks: "fireworksApiKey",
	qwen: "qwenApiKey",
	doubao: "doubaoApiKey",
	mistral: "mistralApiKey",
	litellm: "liteLlmApiKey",
	asksage: "asksageApiKey",
	xai: "xaiApiKey",
	moonshot: "moonshotApiKey",
	zai: "zaiApiKey",
	huggingface: "huggingFaceApiKey",
	nebius: "nebiusApiKey",
	sambanova: "sambanovaApiKey",
	cerebras: "cerebrasApiKey",
	groq: "groqApiKey",
	baseten: "basetenApiKey",
	"huawei-cloud-maas": "huaweiCloudMaasApiKey",
	dify: "difyApiKey",
	minimax: "minimaxApiKey",
	hicap: "hicapApiKey",
	aihubmix: "aihubmixApiKey",
	nousResearch: "nousResearchApiKey",
	"vercel-ai-gateway": "vercelAiGatewayApiKey",
	sapaicore: "sapAiCoreClientId", // SAP uses client ID + secret
	claude_code: "apiKey", // Claude Code uses anthropic key
	wandb: "wandbApiKey",
	"qwen-code": "qwenApiKey",
	oca: "ocaApiKey",
	// "cline" is handled specially — see resolveApiKey()
}

/**
 * Maps a provider ID to the mode-specific model ID field name in ApiConfiguration.
 * For providers that have dedicated model ID fields per mode.
 */
const PROVIDER_MODEL_ID_MAP: Record<string, { plan: keyof ApiConfiguration; act: keyof ApiConfiguration }> = {
	anthropic: { plan: "planModeApiModelId", act: "actModeApiModelId" },
	openrouter: { plan: "planModeOpenRouterModelId", act: "actModeOpenRouterModelId" },
	openai: { plan: "planModeOpenAiModelId", act: "actModeOpenAiModelId" },
	"openai-native": { plan: "planModeApiModelId", act: "actModeApiModelId" },
	"openai-codex": { plan: "planModeApiModelId", act: "actModeApiModelId" },
	ollama: { plan: "planModeOllamaModelId", act: "actModeOllamaModelId" },
	lmstudio: { plan: "planModeLmStudioModelId", act: "actModeLmStudioModelId" },
	gemini: { plan: "planModeApiModelId", act: "actModeApiModelId" },
	bedrock: { plan: "planModeApiModelId", act: "actModeApiModelId" },
	vertex: { plan: "planModeApiModelId", act: "actModeApiModelId" },
	deepseek: { plan: "planModeApiModelId", act: "actModeApiModelId" },
	cline: { plan: "planModeClineModelId", act: "actModeClineModelId" },
	litellm: { plan: "planModeLiteLlmModelId", act: "actModeLiteLlmModelId" },
	requesty: { plan: "planModeRequestyModelId", act: "actModeRequestyModelId" },
	together: { plan: "planModeTogetherModelId", act: "actModeTogetherModelId" },
	fireworks: { plan: "planModeFireworksModelId", act: "actModeFireworksModelId" },
	groq: { plan: "planModeGroqModelId", act: "actModeGroqModelId" },
	baseten: { plan: "planModeBasetenModelId", act: "actModeBasetenModelId" },
	huggingface: { plan: "planModeHuggingFaceModelId", act: "actModeHuggingFaceModelId" },
	"huawei-cloud-maas": { plan: "planModeHuaweiCloudMaasModelId", act: "actModeHuaweiCloudMaasModelId" },
	oca: { plan: "planModeOcaModelId", act: "actModeOcaModelId" },
	aihubmix: { plan: "planModeAihubmixModelId", act: "actModeAihubmixModelId" },
	hicap: { plan: "planModeHicapModelId", act: "actModeHicapModelId" },
	nousResearch: { plan: "planModeNousResearchModelId", act: "actModeNousResearchModelId" },
	"vercel-ai-gateway": { plan: "planModeVercelAiGatewayModelId", act: "actModeVercelAiGatewayModelId" },
	sapaicore: { plan: "planModeSapAiCoreModelId", act: "actModeSapAiCoreModelId" },
}

// ---------------------------------------------------------------------------
// API key resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the API key for a given provider from the ApiConfiguration.
 *
 * For the "cline" provider, reads the OAuth token from providers.json
 * via ProviderSettingsManager (the single source of truth for credentials).
 */
function resolveApiKey(providerId: string, config: ApiConfiguration): string | undefined {
	// For "cline" provider — read from providers.json
	if (providerId === "cline") {
		// First check if clineApiKey is set directly (e.g. from env var)
		if (config.clineApiKey) {
			return config.clineApiKey
		}

		// Read from providers.json via the shared ProviderSettingsManager
		try {
			const manager = getProviderSettingsManager()
			const settings = manager.getProviderSettings("cline")
			const accessToken = settings?.auth?.accessToken?.trim()
			if (accessToken) {
				// providers.json stores the token with workos: prefix already
				return accessToken.toLowerCase().startsWith("workos:") ? accessToken : `workos:${accessToken}`
			}
		} catch {
			Logger.warn("[SessionFactory] Failed to read cline credentials from providers.json")
		}

		return undefined
	}

	// For all other providers, look up the API key field name
	const keyField = PROVIDER_API_KEY_MAP[providerId]
	if (keyField) {
		const apiKey = config[keyField] as string | undefined
		if (apiKey) {
			return apiKey
		}
	}

	return undefined
}

/**
 * Resolve the model ID for a given provider and mode from the ApiConfiguration.
 * Uses mode-specific model ID fields when available, falls back to generic fields.
 */
function resolveModelId(providerId: string, mode: Mode, config: ApiConfiguration): string | undefined {
	// Check provider-specific mode model ID fields
	const modelFields = PROVIDER_MODEL_ID_MAP[providerId]
	if (modelFields) {
		const field = mode === "plan" ? modelFields.plan : modelFields.act
		const modelId = config[field] as string | undefined
		if (modelId) {
			return modelId
		}
	}

	// Fallback to generic mode model ID fields
	const genericField = mode === "plan" ? "planModeApiModelId" : "actModeApiModelId"
	const genericModelId = config[genericField] as string | undefined
	if (genericModelId) {
		return genericModelId
	}

	return undefined
}

/**
 * Resolve the base URL for a given provider from the ApiConfiguration.
 */
function resolveBaseUrl(providerId: string, config: ApiConfiguration): string | undefined {
	const baseUrlMap: Record<string, keyof ApiConfiguration> = {
		anthropic: "anthropicBaseUrl",
		openai: "openAiBaseUrl",
		ollama: "ollamaBaseUrl",
		lmstudio: "lmStudioBaseUrl",
		gemini: "geminiBaseUrl",
		requesty: "requestyBaseUrl",
		litellm: "liteLlmBaseUrl",
		oca: "ocaBaseUrl",
		aihubmix: "aihubmixBaseUrl",
		dify: "difyBaseUrl",
	}

	const field = baseUrlMap[providerId]
	if (field) {
		return config[field] as string | undefined
	}

	return undefined
}

// ---------------------------------------------------------------------------
// Session config builder
// ---------------------------------------------------------------------------

/**
 * Build a CoreSessionConfig from the current state.
 *
 * Reads provider settings from the classic StateManager's ApiConfiguration
 * (which correctly reads from globalState.json + secrets.json), then resolves
 * the provider, model, and API key for the current mode (plan/act).
 *
 * This replaces the previous two-path approach (SDK ProviderSettingsManager +
 * StateManager.buildApiHandlerSettings) which both failed silently.
 */
export async function buildSessionConfig(input: SessionConfigInput): Promise<CoreSessionConfig> {
	let cwd = input.cwd
	if (!cwd) {
		Logger.warn("[SessionFactory] No cwd provided, falling back to process.cwd() — this is likely wrong in VSCode")
		cwd = process.cwd()
	}
	const workspaceRoot = input.workspaceRoot ?? cwd
	const mode: Mode = input.mode ?? "act"
	const sdkLogger = createSdkLogger()
	const distinctId = getDistinctId()

	let providerId: string | undefined
	let modelId: string | undefined
	let apiKey: string | undefined
	let baseUrl: string | undefined

	try {
		const stateManager = StateManager.get()
		const apiConfig = stateManager.getApiConfiguration()

		// Resolve the provider for the current mode
		const modeProvider = mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider
		providerId = modeProvider

		if (providerId) {
			// Resolve API key
			apiKey = resolveApiKey(providerId, apiConfig)

			// Resolve model ID
			modelId = resolveModelId(providerId, mode, apiConfig)

			// Resolve base URL
			baseUrl = resolveBaseUrl(providerId, apiConfig)

			Logger.log(
				`[SessionFactory] Resolved from StateManager: provider=${providerId}, model=${modelId}, hasApiKey=${!!apiKey}`,
			)
		}
	} catch (error) {
		Logger.warn("[SessionFactory] StateManager credential resolution failed:", error)
	}

	// Fallback: try SDK's ProviderSettingsManager if StateManager didn't yield results
	if (!providerId || !apiKey) {
		try {
			const dataDir = resolveDataDir()
			const manager = getProviderSettingsManager(dataDir)
			const lastUsed = manager.getLastUsedProviderSettings()

			if (lastUsed?.provider && lastUsed?.apiKey) {
				providerId = lastUsed.provider
				modelId = lastUsed.model
				apiKey = lastUsed.apiKey
				baseUrl = lastUsed.baseUrl
				Logger.log(`[SessionFactory] Using SDK provider fallback: ${providerId}/${modelId}`)
			}
		} catch (error) {
			Logger.warn("[SessionFactory] SDK ProviderSettingsManager fallback failed:", error)
		}
	}

	// Final defaults
	providerId = providerId ?? "cline"
	modelId = modelId ?? "openai/gpt-5.4"
	apiKey = apiKey ?? ""

	// Build the system prompt using the shared prompt builder. Core still
	// expects callers to provide a concrete systemPrompt, but the prompt builder
	// can derive baseline workspace context from the root path and workspace
	// name, so we avoid duplicating core's richer workspace metadata pass here.
	let systemPrompt = ""
	try {
		const { basename } = await import("path")
		systemPrompt = buildClineSystemPrompt({
			ide: "VS Code",
			workspaceRoot,
			workspaceName: basename(cwd),
			mode: mode === "plan" ? "plan" : "act",
			providerId,
			platform: process.platform,
		})
		Logger.log(`[SessionFactory] Built system prompt: ${systemPrompt.length} chars`)
	} catch (error) {
		Logger.warn("[SessionFactory] Failed to build system prompt, using minimal fallback:", error)
		systemPrompt = "You are Cline, a highly skilled software engineer. Help the user with their request."
	}

	// Append plan-mode instructions when in plan mode, matching the CLI's
	// behavior (apps/cli/src/runtime/prompt.ts). The shared prompt builder does
	// not include these guardrails, so without this the model in plan mode may
	// still attempt to make edits instead of planning.
	if (mode === "plan") {
		systemPrompt = systemPrompt ? `${systemPrompt}\n\n${PLAN_MODE_INSTRUCTIONS}` : PLAN_MODE_INSTRUCTIONS
	}

	const stateManager = StateManager.get()
	const globalSubagentsEnabled = stateManager.getGlobalSettingsKey("subagentsEnabled") ?? false

	const config: CoreSessionConfig = {
		providerId,
		modelId,
		apiKey,
		baseUrl,
		cwd,
		workspaceRoot,
		systemPrompt,
		enableTools: true,
		enableSpawnAgent: input.taskSettings?.subagentsEnabled ?? globalSubagentsEnabled,
		enableAgentTeams: false,
		disableMcpSettingsTools: true,
		mode: mode === "plan" ? "plan" : "act",
		thinking: false,
		maxIterations: undefined,
		logger: sdkLogger,
		extensionContext: {
			user: distinctId ? { distinctId } : undefined,
			client: {
				name: "cline-vscode",
				version: ExtensionRegistryInfo.version,
			},
			workspace: {
				rootPath: workspaceRoot,
				cwd,
				workspaceName: workspaceRoot.split(/[\\/]/).filter(Boolean).pop() ?? workspaceRoot,
				ide: "VS Code",
				platform: process.platform,
				mode: mode === "plan" ? "plan" : "act",
			},
			logger: sdkLogger,
		},
		hooks: buildAgentHooks(StateManager.get()),
	}

	return config
}

// ---------------------------------------------------------------------------
// Session factory
// ---------------------------------------------------------------------------

/**
 * Build the StartSessionInput for a new task.
 *
 * IMPORTANT: We pass `interactive: true` but NO `prompt`. This creates the
 * session and returns immediately — the runtime host only executes a turn when
 * a prompt is sent. The caller should then call `core.send({ sessionId, prompt })`
 * to run the first turn. This cleanly separates session creation from
 * inference, preventing the gRPC handler from blocking until the first
 * agent turn completes.
 */
export function buildStartSessionInput(config: CoreSessionConfig, input: SessionConfigInput): ClineCoreStartInput {
	return {
		config,
		// Do NOT pass prompt here — start() should return immediately.
		// The prompt is sent separately via core.send() after session creation.
		prompt: undefined,
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

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
import type { ApiConfiguration } from "@shared/api"
import type { HistoryItem } from "@shared/HistoryItem"
import { Logger } from "@shared/services/Logger"
import type { Settings } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
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
 * Special handling for the "cline" provider: the OAuth token is stored in
 * `secrets.json` under `cline:clineAccountId` as a JSON object containing
 * `idToken`. We extract it and add the `workos:` prefix, matching the
 * classic AuthService.getAuthToken() behavior.
 */
function resolveApiKey(providerId: string, config: ApiConfiguration): string | undefined {
	// Special handling for "cline" provider — extract OAuth token from secrets
	if (providerId === "cline") {
		// First check if clineApiKey is set directly
		if (config.clineApiKey) {
			return config.clineApiKey
		}

		// Extract from the cline:clineAccountId secret (JSON with idToken)
		const clineAccountSecret = config["cline:clineAccountId" as keyof ApiConfiguration] as string | undefined
		if (clineAccountSecret) {
			try {
				const parsed = JSON.parse(clineAccountSecret)
				if (parsed.idToken) {
					return `workos:${parsed.idToken}`
				}
			} catch {
				Logger.warn("[SessionFactory] Failed to parse cline:clineAccountId secret")
			}
		}

		// Fallback: check clineAccountId (legacy key)
		const clineAccountId = config.clineAccountId
		if (clineAccountId) {
			// clineAccountId might be the raw token or a JSON string
			try {
				const parsed = JSON.parse(clineAccountId)
				if (parsed.idToken) {
					return `workos:${parsed.idToken}`
				}
			} catch {
				// Not JSON — treat as raw token
				return `workos:${clineAccountId}`
			}
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
	const cwd = input.cwd || process.cwd()
	const workspaceRoot = input.workspaceRoot ?? cwd
	const mode: Mode = input.mode ?? "act"

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
		mode: mode === "plan" ? "plan" : "act",
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
 *
 * **MCP filtering**: The SDK's MCP client (`StdioMcpClient`) only supports
 * `stdio` transport. If the user's MCP settings include `streamableHttp` or
 * `sse` servers, the SDK throws "Unsupported MCP transport" errors during
 * session start. To prevent this, we write a filtered copy of the MCP
 * settings (containing only `stdio` servers) to a temp file and point the
 * SDK to it via the `CLINE_MCP_SETTINGS_PATH` environment variable.
 *
 * **Future streamableHttp support**: When the SDK supports streamableHttp
 * transports (or when we provide a custom `RuntimeBuilder` with a
 * `clientFactory` that delegates to the classic `McpHub`), this filtering
 * can be removed. The hook point is `DefaultRuntimeBuilder`'s
 * `loadConfiguredMcpTools()` which creates an `InMemoryMcpManager` with
 * `createDefaultMcpServerClientFactory()`. A custom `RuntimeBuilder` can
 * provide its own `clientFactory` that uses the classic McpHub's already-
 * connected streamableHttp clients instead of the SDK's stdio-only client.
 */
export async function createClineCore(): Promise<ClineCore> {
	// Filter MCP settings to only include stdio servers (the SDK's MCP
	// client only supports stdio). This sets CLINE_MCP_SETTINGS_PATH
	// for the SDK to read from.
	await ensureFilteredMcpSettings()

	const core = await ClineCore.create({
		clientName: "cline-vscode",
		backendMode: "local",
	})

	Logger.log("[SessionFactory] ClineCore instance created")
	return core
}

/**
 * Write a filtered copy of MCP settings that only includes stdio servers.
 * Sets `CLINE_MCP_SETTINGS_PATH` env var to point to the filtered file.
 *
 * The SDK's `InMemoryMcpManager` only supports stdio transport. Servers
 * with `streamableHttp` or `sse` transport cause "Unsupported MCP transport"
 * errors during session start. By filtering them out at the settings level,
 * we allow the SDK to connect only to stdio servers while the classic
 * `McpHub` continues to manage all server types for the webview UI.
 *
 * **Future improvement**: Replace this filtering with a custom `RuntimeBuilder`
 * that provides a `clientFactory` delegating to the classic `McpHub`'s
 * already-connected clients. This would give the SDK access to all transport
 * types (stdio, sse, streamableHttp) without modifying the settings file.
 */
async function ensureFilteredMcpSettings(): Promise<void> {
	try {
		const dataDir = resolveDataDir()
		const settingsPath = join(dataDir, "settings", "cline_mcp_settings.json")

		if (!existsSync(settingsPath)) {
			return // No settings file — nothing to filter
		}

		const raw = readFileSync(settingsPath, "utf8")
		const parsed = JSON.parse(raw) as {
			mcpServers?: Record<string, McpServerConfig>
		}

		const servers = parsed.mcpServers ?? {}
		const filteredServers: Record<string, McpServerConfig> = {}
		let skippedCount = 0

		for (const [name, config] of Object.entries(servers)) {
			// The SDK's StdioMcpClient only supports stdio transport.
			// Skip streamableHttp and sse servers — they'll be managed
			// by the classic McpHub for the webview UI instead.
			if (config.type === "streamableHttp" || config.type === "sse") {
				skippedCount++
				continue
			}
			filteredServers[name] = config
		}

		if (skippedCount > 0) {
			Logger.log(
				`[SessionFactory] Filtered ${skippedCount} non-stdio MCP server(s) from SDK settings (SDK only supports stdio transport)`,
			)
		}

		// Write filtered settings to a temp file
		const filteredPath = join(dataDir, "settings", "cline_mcp_settings_sdk.json")
		writeFileSync(filteredPath, JSON.stringify({ mcpServers: filteredServers }, null, 2))

		// Point the SDK to the filtered settings
		process.env.CLINE_MCP_SETTINGS_PATH = filteredPath
	} catch (error) {
		Logger.warn("[SessionFactory] Failed to filter MCP settings:", error)
	}
}

/** Minimal MCP server config type for filtering */
interface McpServerConfig {
	type?: string
	[key: string]: unknown
}

/**
 * Build the StartSessionInput for a new task.
 *
 * IMPORTANT: We pass `interactive: true` but NO `prompt`. This creates the
 * session and returns immediately — the SDK's DefaultSessionManager.start()
 * checks `if (startInput.prompt?.trim())` and skips `runTurn()` when there's
 * no prompt. The caller should then call `core.send({ sessionId, prompt })`
 * to run the first turn. This cleanly separates session creation from
 * inference, preventing the gRPC handler from blocking until the first
 * agent turn completes.
 */
export function buildStartSessionInput(config: CoreSessionConfig, input: SessionConfigInput): StartSessionInput {
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

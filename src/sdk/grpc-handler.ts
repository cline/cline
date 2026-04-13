/**
 * gRPC Handler (Compatibility Layer)
 *
 * Handles gRPC-style method calls from the existing webview. The webview
 * sends requests via the protobus message passing system, and this handler
 * translates them into SDK adapter operations.
 *
 * This is a compat layer: the webview thinks it's talking to the classic
 * Controller, but it's actually talking to the SDK adapter.
 *
 * Critical methods (must work for basic functionality):
 * - getLatestState: returns current ExtensionState as JSON
 * - subscribeToState: stores subscription for state push notifications
 * - subscribeToPartialMessage: stores subscription for streaming updates
 * - newTask: creates a new SDK session
 * - askResponse: sends user response to a pending ask
 * - clearTask: resets current session
 * - cancelTask: aborts current session
 * - getTaskHistory: returns task history
 * - updateApiConfigurationProto: updates provider/model
 * - togglePlanActModeProto: switches plan/act mode
 * - updateSettings: updates settings
 * - initializeWebview: initialization handshake
 *
 * Non-critical methods return empty/default responses so the webview
 * doesn't error out.
 */

import type { ApiConfiguration, ModelInfo } from "@shared/api"
import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import { Logger } from "@shared/services/Logger"
import type { Mode } from "@shared/storage/types"
import { readClineModelsFromCache } from "../core/controller/models/refreshClineModels"
import { readMcpMarketplaceCatalogFromCache } from "../core/storage/disk"
import { toProtobufModels } from "../shared/proto-conversions/models/typeConversion"
import { getAvailableTerminalProfiles } from "../utils/shell"

/** File search result */
export interface FileSearchResult {
	path: string
	type: string
	label?: string
}

// ---------------------------------------------------------------------------
// Proto enum string → app string conversion for API providers
// ---------------------------------------------------------------------------

/**
 * Maps proto-JSON enum string names (e.g., "OLLAMA") to application
 * provider strings (e.g., "ollama"). Proto3 JSON encoding uses the
 * enum value's NAME, not its number.
 */
const PROTO_PROVIDER_STRING_TO_APP: Record<string, string> = {
	ANTHROPIC: "anthropic",
	OPENROUTER: "openrouter",
	BEDROCK: "bedrock",
	VERTEX: "vertex",
	OPENAI: "openai",
	OLLAMA: "ollama",
	LMSTUDIO: "lmstudio",
	GEMINI: "gemini",
	OPENAI_NATIVE: "openai-native",
	REQUESTY: "requesty",
	TOGETHER: "together",
	DEEPSEEK: "deepseek",
	QWEN: "qwen",
	QWEN_CODE: "qwen-code",
	DOUBAO: "doubao",
	MISTRAL: "mistral",
	VSCODE_LM: "vscode-lm",
	CLINE: "cline",
	LITELLM: "litellm",
	MOONSHOT: "moonshot",
	HUGGINGFACE: "huggingface",
	NEBIUS: "nebius",
	WANDB: "wandb",
	FIREWORKS: "fireworks",
	ASKSAGE: "asksage",
	XAI: "xai",
	SAMBANOVA: "sambanova",
	CEREBRAS: "cerebras",
	GROQ: "groq",
	BASETEN: "baseten",
	SAPAICORE: "sapaicore",
	CLAUDE_CODE: "claude-code",
	HUAWEI_CLOUD_MAAS: "huawei-cloud-maas",
	VERCEL_AI_GATEWAY: "vercel-ai-gateway",
	ZAI: "zai",
	DIFY: "dify",
	OCA: "oca",
	AIHUBMIX: "aihubmix",
	MINIMAX: "minimax",
	HICAP: "hicap",
	NOUSRESEARCH: "nousResearch",
	OPENAI_CODEX: "openai-codex",
}

/**
 * Maps proto numeric enum values to application provider strings.
 * VSCode uses messageEncoding: "none", so proto objects pass through
 * with raw numeric enum values (not JSON string names).
 *
 * Values from proto/cline/models.proto ApiProvider enum.
 */
const PROTO_PROVIDER_NUM_TO_APP: Record<number, string> = {
	0: "anthropic",
	1: "openrouter",
	2: "bedrock",
	3: "vertex",
	4: "openai",
	5: "ollama",
	6: "lmstudio",
	7: "gemini",
	8: "openai-native",
	9: "requesty",
	10: "together",
	11: "deepseek",
	12: "qwen",
	13: "doubao",
	14: "mistral",
	15: "vscode-lm",
	16: "cline",
	17: "litellm",
	18: "nebius",
	19: "fireworks",
	20: "asksage",
	21: "xai",
	22: "sambanova",
	23: "cerebras",
	24: "groq",
	25: "sapaicore",
	26: "claude-code",
	27: "moonshot",
	28: "huggingface",
	29: "huawei-cloud-maas",
	30: "baseten",
	31: "zai",
	32: "vercel-ai-gateway",
	33: "qwen-code",
	34: "dify",
	35: "oca",
	36: "minimax",
	37: "hicap",
	38: "aihubmix",
	39: "nousResearch",
	40: "openai-codex",
	41: "wandb",
}

/**
 * Convert a value that might be a proto enum number (e.g., 5 for OLLAMA),
 * a proto enum string (e.g., "OLLAMA"), or already an app string
 * (e.g., "ollama") to the app string format.
 */
function normalizeProvider(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined

	// Handle numeric enum values (VSCode passes proto objects as-is)
	if (typeof value === "number") {
		return PROTO_PROVIDER_NUM_TO_APP[value] ?? String(value)
	}

	const str = String(value)

	// Handle numeric strings (e.g., "16" from JSON stringification)
	const num = Number(str)
	if (!Number.isNaN(num) && PROTO_PROVIDER_NUM_TO_APP[num] !== undefined) {
		return PROTO_PROVIDER_NUM_TO_APP[num]
	}

	// Handle proto string names (e.g., "OLLAMA")
	if (PROTO_PROVIDER_STRING_TO_APP[str]) {
		return PROTO_PROVIDER_STRING_TO_APP[str]
	}

	// Already in app format (e.g., "ollama")
	return str
}

/**
 * Convert a proto-JSON-encoded ApiConfiguration to application format.
 *
 * The webview sends updateApiConfigurationProto with proto-JSON where:
 * - Provider fields use proto enum names ("OLLAMA" not "ollama")
 * - The config is wrapped in an "apiConfiguration" field
 *
 * This function handles both cases:
 * - Wrapped: { apiConfiguration: { actModeApiProvider: "OLLAMA", ... } }
 * - Unwrapped: { actModeApiProvider: "OLLAMA", ... }
 */
function convertProtoJsonToApiConfig(params: Record<string, unknown>): Partial<ApiConfiguration> {
	// Unwrap if nested inside apiConfiguration
	const raw = (params.apiConfiguration as Record<string, unknown>) ?? params
	const config: Record<string, unknown> = { ...raw }

	// Convert provider fields from proto enum format to app format
	const providerFields = ["planModeApiProvider", "actModeApiProvider", "apiProvider"]
	for (const field of providerFields) {
		if (config[field] !== undefined) {
			config[field] = normalizeProvider(config[field])
		}
	}

	return config as Partial<ApiConfiguration>
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A generic gRPC-style request */
export interface GrpcRequest {
	/** The RPC method name (e.g., "getLatestState", "newTask") */
	method: string
	/** The request payload (decoded protobuf as plain object) */
	params?: Record<string, unknown>
}

/** A generic gRPC-style response */
export interface GrpcResponse {
	/** Response payload (will be encoded as protobuf) */
	data?: unknown
	/** Error message if the call failed */
	error?: string
}

/** Callback for subscription-based methods */
export type SubscriptionCallback = (data: unknown) => void

/** Delegate interface — the adapter that actually does the work */
export interface GrpcHandlerDelegate {
	/** Get the current ExtensionState */
	getState(): ExtensionState

	/** Start a new task/session */
	newTask(text: string, images?: string[]): Promise<void>

	/** Send a response to a pending ask */
	askResponse(response: string, text?: string, images?: string[]): Promise<void>

	/** Clear the current task */
	clearTask(): Promise<void>

	/** Cancel the current task */
	cancelTask(): Promise<void>

	/** Get task history */
	getTaskHistory(offset?: number, limit?: number): HistoryItem[]

	/** Show a task by ID (resume) */
	showTaskWithId(id: string): Promise<void>

	/** Delete tasks by IDs */
	deleteTasksWithIds(ids: string[]): Promise<void>

	/** Update API configuration */
	updateApiConfiguration(config: Partial<ApiConfiguration>): Promise<void>

	/** Toggle plan/act mode */
	togglePlanActMode(mode: Mode): Promise<void>

	/** Update a setting */
	updateSettings(settings: Record<string, unknown>): Promise<void>

	/** Update auto-approval settings */
	updateAutoApprovalSettings(settings: Record<string, unknown>): Promise<void>

	/** Get Cline auth credentials (for auth status) */
	getClineAuthInfo?(): {
		idToken: string
		userInfo: {
			id: string
			email: string
			displayName: string
			organizations?: Array<{ active: boolean; organizationId: string; name: string; memberId: string; roles?: string[] }>
		}
	} | null

	/** Search workspace files (for @ mentions) */
	searchFiles?(query: string, type?: string, limit?: number): Promise<FileSearchResult[]>

	/** Open a file picker dialog (platform-specific) */
	selectFiles?(allowImages: boolean): Promise<{ images: string[]; files: string[] }>

	// -----------------------------------------------------------------------
	// State persistence (read/write globalState.json keys)
	// -----------------------------------------------------------------------

	/** Read a value from persistent global state */
	readGlobalStateKey?(key: string): unknown

	/** Write a value to persistent global state and push state update */
	writeGlobalStateKey?(key: string, value: unknown): void

	// -----------------------------------------------------------------------
	// Task operations
	// -----------------------------------------------------------------------

	/** Toggle favorite flag on a task history item */
	toggleTaskFavorite?(taskId: string, isFavorite: boolean): Promise<void>

	/** Get total size of task storage in bytes */
	getTotalTasksSize?(): Promise<number>

	/** Export a task by ID (platform-specific: opens save dialog or returns data) */
	exportTaskWithId?(taskId: string): Promise<void>

	// -----------------------------------------------------------------------
	// Platform operations (injected by host — VSCode, CLI, etc.)
	// -----------------------------------------------------------------------

	/** Open a URL in the default browser */
	openUrl?(url: string): Promise<void>

	/** Open a file in the editor */
	openFile?(filePath: string): Promise<void>

	/** Copy text to clipboard */
	copyToClipboard?(text: string): Promise<void>

	/** Open MCP settings file */
	openMcpSettings?(): Promise<void>

	// -----------------------------------------------------------------------
	// Data queries
	// -----------------------------------------------------------------------

	/** Convert absolute/URI paths to workspace-relative paths */
	getRelativePaths?(uris: string[]): Promise<string[]>

	/** Check if a URL points to an image */
	checkIsImageUrl?(url: string): Promise<boolean>

	/** Get the current working directory (for workspace filtering) */
	cwd?: string

	// -----------------------------------------------------------------------
	// Model discovery
	// -----------------------------------------------------------------------

	/** Fetch available models from a local Ollama endpoint */
	getOllamaModels?(endpoint: string): Promise<string[]>

	/** Fetch available models from a local LM Studio endpoint */
	getLmStudioModels?(endpoint: string): Promise<string[]>

	// -----------------------------------------------------------------------
	// MCP servers
	// -----------------------------------------------------------------------

	/** Read MCP servers from settings file and return proto-shaped objects */
	getMcpServers?(): McpServerProto[]

	// -----------------------------------------------------------------------
	// Account operations
	// -----------------------------------------------------------------------

	/** Clear Cline auth credentials (logout) */
	clearClineAuth?(): void

	/** Update the active organization */
	setActiveOrganization?(organizationId: string | undefined): void

	/** Fetch user credits from the Cline API */
	fetchUserCredits?(): Promise<{
		balance?: { currentBalance: number }
		usageTransactions?: unknown[]
		paymentTransactions?: unknown[]
	}>

	/** Fetch organization credits from the Cline API */
	fetchOrganizationCredits?(
		organizationId: string,
	): Promise<{ balance?: { currentBalance: number }; usageTransactions?: unknown[] }>

	/** Perform Cline OAuth login flow */
	performClineOAuth?(): Promise<void>
}

/**
 * Proto-shaped McpServer object.
 * Matches the shape expected by convertProtoMcpServersToMcpServers in the webview.
 * Status enum: 0=disconnected, 1=connected, 2=connecting
 */
export interface McpServerProto {
	name: string
	config: string
	status: number
	error: string
	tools: McpToolProto[]
	resources: McpResourceProto[]
	resourceTemplates: McpResourceTemplateProto[]
	prompts: McpPromptProto[]
	disabled: boolean
	timeout: number
	oauthRequired?: boolean
	oauthAuthStatus?: string
}

export interface McpToolProto {
	name: string
	description?: string
	inputSchema?: string
	autoApprove?: boolean
}

export interface McpResourceProto {
	uri: string
	name: string
	mimeType?: string
	description?: string
}

export interface McpResourceTemplateProto {
	uriTemplate: string
	name: string
	mimeType?: string
	description?: string
}

export interface McpPromptProto {
	name: string
	title?: string
	description?: string
	arguments: { name: string; description?: string; required?: boolean }[]
}

// ---------------------------------------------------------------------------
// GrpcHandler
// ---------------------------------------------------------------------------

/** Navigation callback type (fired by handlers that need to trigger view navigation) */
export type NavigateCallback = (view: string, opts?: { tab?: string; targetSection?: string }) => void

export class GrpcHandler {
	private delegate: GrpcHandlerDelegate
	private stateSubscriptions = new Map<string, SubscriptionCallback>()
	private partialMessageSubscriptions = new Map<string, SubscriptionCallback>()
	private nextSubscriptionId = 0
	private onNavigateCallback?: NavigateCallback

	constructor(delegate: GrpcHandlerDelegate) {
		this.delegate = delegate
	}

	/** Set a callback for navigation events (used by the bridge to send typed messages) */
	setOnNavigate(callback: NavigateCallback): void {
		this.onNavigateCallback = callback
	}

	/**
	 * Handle a gRPC-style request from the webview.
	 * Returns a response, or undefined for unknown methods (graceful).
	 */
	async handleRequest(request: GrpcRequest): Promise<GrpcResponse> {
		try {
			switch (request.method) {
				// ---- State ----
				case "getLatestState":
					return this.handleGetLatestState()

				case "subscribeToState":
					return this.handleSubscribeToState(request)

				case "subscribeToPartialMessage":
					return this.handleSubscribeToPartialMessage(request)

				// ---- Task lifecycle ----
				case "newTask":
					return await this.handleNewTask(request)

				case "askResponse":
					return await this.handleAskResponse(request)

				case "clearTask":
					return await this.handleClearTask()

				case "cancelTask":
					return await this.handleCancelTask()

				// ---- Task history ----
				case "getTaskHistory":
					return this.handleGetTaskHistory(request)

				case "showTaskWithId":
					return await this.handleShowTaskWithId(request)

				case "deleteTasksWithIds":
					return await this.handleDeleteTasksWithIds(request)

				case "deleteAllTaskHistory":
					return await this.handleDeleteAllTaskHistory()

				// ---- Configuration ----
				case "updateApiConfigurationProto":
				case "updateApiConfiguration":
					return await this.handleUpdateApiConfiguration(request)

				case "togglePlanActModeProto":
					return await this.handleTogglePlanActMode(request)

				// ---- File operations ----
				case "searchFiles":
					return await this.handleSearchFiles(request)

				case "selectFiles":
					return await this.handleSelectFiles(request)

				// ---- Navigation ----
				case "scrollToSettings":
					return this.handleScrollToSettings(request)

				case "updateSettings":
					return await this.handleUpdateSettings(request)

				case "updateAutoApprovalSettings":
					return await this.handleUpdateAutoApprovalSettings(request)

				// ---- Initialization ----
				case "initializeWebview":
					return this.handleInitializeWebview()

				// ---- Auth methods (return real data from disk credentials) ----
				case "subscribeToAuthStatusUpdate":
					return this.handleSubscribeToAuthStatusUpdate()
				case "getUserOrganizations":
					return this.handleGetUserOrganizations()
				case "getUserCredits":
					return await this.handleGetUserCredits()
				case "getOrganizationCredits":
					return await this.handleGetOrganizationCredits(request)

				// ---- Account operations ----
				case "accountLoginClicked":
					return await this.handleAccountLoginClicked()
				case "accountLogoutClicked":
					return this.handleAccountLogout()
				case "setUserOrganization":
					return this.handleSetUserOrganization(request)

				// ---- Terminal profiles ----
				case "getAvailableTerminalProfiles":
					return this.handleGetAvailableTerminalProfiles()

				// ---- State persistence (globalState.json writes) ----
				case "updateTelemetrySetting":
					return this.handleUpdateTelemetrySetting(request)

				case "setWelcomeViewCompleted":
					return this.handleSetWelcomeViewCompleted(request)

				case "onDidShowAnnouncement":
					return this.handleOnDidShowAnnouncement()

				case "toggleFavoriteModel":
					return this.handleToggleFavoriteModel(request)

				case "dismissBanner":
					return this.handleDismissBanner(request)

				case "updateInfoBannerVersion":
					return this.handleUpdateBannerVersion(request, "lastDismissedInfoBannerVersion")

				case "updateModelBannerVersion":
					return this.handleUpdateBannerVersion(request, "lastDismissedModelBannerVersion")

				case "updateCliBannerVersion":
					return this.handleUpdateBannerVersion(request, "lastDismissedCliBannerVersion")

				case "resetState":
					return await this.handleResetState(request)

				case "toggleTaskFavorite":
					return await this.handleToggleTaskFavorite(request)

				case "captureOnboardingProgress":
					// Telemetry event — safe no-op in SDK mode
					return { data: {} }

				// ---- Platform operations ----
				case "openUrl":
				case "openInBrowser":
					return await this.handleOpenUrl(request)

				case "openFile":
				case "openFileRelativePath":
				case "openImage":
				case "openMention":
					return await this.handleOpenFile(request)

				case "copyToClipboard":
					return await this.handleCopyToClipboard(request)

				case "openMcpSettings":
					return await this.handleOpenMcpSettings()

				// ---- Data queries ----
				case "getRelativePaths":
					return await this.handleGetRelativePaths(request)

				case "checkIsImageUrl":
					return await this.handleCheckIsImageUrl(request)

				case "getTotalTasksSize":
					return await this.handleGetTotalTasksSize()

				case "exportTaskWithId":
					return await this.handleExportTaskWithId(request)

				// ---- Model discovery (local servers) ----
				case "getOllamaModels":
					return await this.handleGetOllamaModels(request)

				case "getLmStudioModels":
					return await this.handleGetLmStudioModels(request)

				// ---- MCP servers ----
				case "getLatestMcpServers":
					return this.handleGetLatestMcpServers()

				// ---- Model discovery (Cline provider) ----
				case "refreshClineModelsRpc":
					return await this.handleRefreshClineModels()

				// ---- Stubbed methods (return empty, log for debugging) ----
				// These still need real implementations for full feature parity.
				// Search for "[grpc-handler] STUB:" in console to find active calls.
				case "refreshOpenRouterModelsRpc":
				case "refreshLiteLlmModelsRpc":
				case "refreshBasetenModelsRpc":
				case "refreshVercelAiGatewayModelsRpc":
				case "refreshGroqModelsRpc":
				case "refreshRequestyModels":
				case "refreshHuggingFaceModels":
				case "refreshHicapModels":
				case "refreshOcaModels":
				case "getVsCodeLmModels":
				case "getSapAiCoreModels":
				case "getAihubmixModels":
				case "refreshOpenAiModels":
				case "subscribeToMcpServers":
				case "subscribeToMcpButtonClicked":
				case "subscribeToHistoryButtonClicked":
				case "subscribeToChatButtonClicked":
				case "subscribeToSettingsButtonClicked":
				case "subscribeToWorktreesButtonClicked":
				case "subscribeToAccountButtonClicked":
				case "subscribeToOpenRouterModels":
				case "subscribeToLiteLlmModels":
				case "subscribeToRelinquishControl":
				case "subscribeToShowWebview":
				case "subscribeToAddToInput":
				case "openWalkthrough":
				case "searchCommits":
				case "ifFileExistsRelativePath":
				case "openDiskConversationHistory":
				case "createRuleFile":
				case "deleteRuleFile":
				case "toggleClineRule":
				case "toggleCursorRule":
				case "toggleWindsurfRule":
				case "toggleAgentsRule":
				case "toggleWorkflow":
				case "toggleHook":
				case "toggleSkill":
				case "deleteSkillFile":
				case "createSkillFile":
				case "createHook":
				case "deleteHook":
				case "refreshRules":
				case "refreshHooks":
				case "refreshSkills":
				case "checkpointRestore":
				case "checkpointDiff":
				case "restartMcpServer":
				case "deleteMcpServer":
				case "toggleToolAutoApprove":
				case "toggleMcpServer":
				case "authenticateMcpServer":
				case "updateMcpTimeout":
				case "addRemoteMcpServer":
				case "refreshMcpMarketplace":
				case "downloadMcp":
				case "openAiCodexSignIn":
				case "openAiCodexSignOut":
				case "openrouterAuthClicked":
				case "requestyAuthClicked":
				case "hicapAuthClicked":
				case "ocaAccountLoginClicked":
				case "ocaAccountLogoutClicked":
				case "ocaSubscribeToAuthStatusUpdate":
				case "getRedirectUrl":
				case "getBrowserConnectionInfo":
				case "getDetectedChromePath":
				case "testBrowserConnection":
				case "discoverBrowser":
				case "relaunchChromeDebugMode":
				case "setTerminalExecutionMode":
				case "updateTerminalConnectionTimeout":
				case "listWorktrees":
				case "getWorktreeDefaults":
				case "getWorktreeIncludeStatus":
				case "createWorktree":
				case "deleteWorktree":
				case "switchWorktree":
				case "mergeWorktree":
				case "createWorktreeInclude":
				case "trackWorktreeViewOpened":
				case "fetchOpenGraphData":
				case "installClineCli":
				case "refreshRemoteConfig":
				case "testOtelConnection":
				case "testPromptUploading":
				case "condense":
				case "taskFeedback":
				case "taskCompletionViewChanges":
				case "explainChanges":
				case "cancelBackgroundCommand":
				case "getProcessInfo":
					Logger.log(`[grpc-handler] STUB: ${request.method}`, request.params ? Object.keys(request.params) : [])
					return { data: {} }

				default:
					// Unknown method — return empty response (not error)
					Logger.log(`[grpc-handler] UNKNOWN: ${request.method}`, request.params ? Object.keys(request.params) : [])
					return { data: {} }
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			return { error: message }
		}
	}

	// -----------------------------------------------------------------------
	// Push notifications (call these to push state to webview)
	// -----------------------------------------------------------------------

	/** Push state update to all state subscribers */
	pushState(state: ExtensionState): void {
		for (const cb of this.stateSubscriptions.values()) {
			try {
				cb(state)
			} catch {
				// Ignore callback errors
			}
		}
	}

	/** Push partial message update to all subscribers */
	pushPartialMessage(message: ClineMessage): void {
		for (const cb of this.partialMessageSubscriptions.values()) {
			try {
				cb(message)
			} catch {
				// Ignore callback errors
			}
		}
	}

	/** Get the number of active state subscriptions */
	getStateSubscriptionCount(): number {
		return this.stateSubscriptions.size
	}

	/** Get the number of active partial message subscriptions */
	getPartialMessageSubscriptionCount(): number {
		return this.partialMessageSubscriptions.size
	}

	// -----------------------------------------------------------------------
	// Request handlers
	// -----------------------------------------------------------------------

	private handleGetLatestState(): GrpcResponse {
		const state = this.delegate.getState()
		return { data: state }
	}

	private handleSubscribeToState(request: GrpcRequest): GrpcResponse {
		const id = String(this.nextSubscriptionId++)
		const callback = request.params?.callback as SubscriptionCallback | undefined
		if (callback) {
			this.stateSubscriptions.set(id, callback)
		}
		// Immediately push current state
		if (callback) {
			callback(this.delegate.getState())
		}
		return { data: { subscriptionId: id } }
	}

	private handleSubscribeToPartialMessage(request: GrpcRequest): GrpcResponse {
		const id = String(this.nextSubscriptionId++)
		const callback = request.params?.callback as SubscriptionCallback | undefined
		if (callback) {
			this.partialMessageSubscriptions.set(id, callback)
		}
		return { data: { subscriptionId: id } }
	}

	private async handleNewTask(request: GrpcRequest): Promise<GrpcResponse> {
		const text = (request.params?.text as string) ?? ""
		const images = request.params?.images as string[] | undefined
		await this.delegate.newTask(text, images)
		return { data: {} }
	}

	private async handleAskResponse(request: GrpcRequest): Promise<GrpcResponse> {
		// Proto field is response_type (camelCase: responseType)
		const response =
			(request.params?.responseType as string) ??
			(request.params?.response_type as string) ??
			(request.params?.response as string) ??
			"messageResponse"
		const text = request.params?.text as string | undefined
		const images = request.params?.images as string[] | undefined
		await this.delegate.askResponse(response, text, images)
		return { data: {} }
	}

	private async handleClearTask(): Promise<GrpcResponse> {
		await this.delegate.clearTask()
		return { data: {} }
	}

	private async handleCancelTask(): Promise<GrpcResponse> {
		await this.delegate.cancelTask()
		return { data: {} }
	}

	private handleGetTaskHistory(request: GrpcRequest): GrpcResponse {
		// Get all task history from the delegate
		let history = this.delegate.getTaskHistory()

		// Apply filters from GetTaskHistoryRequest
		const favoritesOnly = request.params?.favoritesOnly as boolean | undefined
		const searchQuery = request.params?.searchQuery as string | undefined
		const sortBy = request.params?.sortBy as string | undefined
		const currentWorkspaceOnly = request.params?.currentWorkspaceOnly as boolean | undefined

		if (favoritesOnly) {
			history = history.filter((item) => item.isFavorited)
		}

		if (currentWorkspaceOnly) {
			// Filter by current workspace (compare cwdOnTaskInitialization)
			const cwd = this.delegate.cwd
			if (cwd) {
				history = history.filter((item) => item.cwdOnTaskInitialization === cwd)
			}
		}

		if (searchQuery?.trim()) {
			const q = searchQuery.toLowerCase()
			history = history.filter((item) => item.task?.toLowerCase().includes(q) || item.id?.toLowerCase().includes(q))
		}

		// Sort
		switch (sortBy) {
			case "oldest":
				history = [...history].sort((a, b) => a.ts - b.ts)
				break
			case "mostExpensive":
				history = [...history].sort((a, b) => (b.totalCost ?? 0) - (a.totalCost ?? 0))
				break
			case "mostTokens":
				history = [...history].sort(
					(a, b) => (b.tokensIn ?? 0) + (b.tokensOut ?? 0) - ((a.tokensIn ?? 0) + (a.tokensOut ?? 0)),
				)
				break
			default:
				history = [...history].sort((a, b) => b.ts - a.ts)
				break
		}

		const totalCount = history.length
		const offset = (request.params?.offset as number) ?? 0
		const limit = request.params?.limit as number | undefined
		const pagedHistory = limit !== undefined ? history.slice(offset, offset + limit) : history.slice(offset)

		// Map HistoryItem → TaskItem proto shape
		const tasks = pagedHistory.map((item) => ({
			id: item.id,
			task: item.task,
			ts: item.ts,
			isFavorited: item.isFavorited ?? false,
			size: 0, // Size calculated on demand, not per-item here
			totalCost: item.totalCost ?? 0,
			tokensIn: item.tokensIn ?? 0,
			tokensOut: item.tokensOut ?? 0,
			cacheWrites: item.cacheWrites ?? 0,
			cacheReads: item.cacheReads ?? 0,
			modelId: "",
		}))

		return { data: { tasks, totalCount } }
	}

	private async handleShowTaskWithId(request: GrpcRequest): Promise<GrpcResponse> {
		const id = (request.params?.value as string) ?? ""
		await this.delegate.showTaskWithId(id)
		// Navigate to chat view so the webview hides history/other overlays
		this.onNavigateCallback?.("chat")
		return { data: {} }
	}

	private async handleDeleteTasksWithIds(request: GrpcRequest): Promise<GrpcResponse> {
		const ids = (request.params?.value as string[]) ?? []
		await this.delegate.deleteTasksWithIds(ids)
		return { data: {} }
	}

	private async handleDeleteAllTaskHistory(): Promise<GrpcResponse> {
		await this.delegate.deleteTasksWithIds([]) // empty = delete all
		return { data: {} }
	}

	private async handleUpdateApiConfiguration(request: GrpcRequest): Promise<GrpcResponse> {
		// The webview sends proto-JSON-encoded config with:
		// 1. Config nested inside { apiConfiguration: { ... } }
		// 2. Provider fields as proto enum strings ("OLLAMA" not "ollama")
		// convertProtoJsonToApiConfig handles both unwrapping and conversion.
		const config = convertProtoJsonToApiConfig(request.params ?? {})
		await this.delegate.updateApiConfiguration(config)
		return { data: {} }
	}

	private async handleTogglePlanActMode(request: GrpcRequest): Promise<GrpcResponse> {
		const rawMode = request.params?.mode
		// Convert proto enum: 0/"PLAN" → "plan", 1/"ACT" → "act"
		let mode: Mode
		if (rawMode === 0 || rawMode === "PLAN") {
			mode = "plan"
		} else if (rawMode === 1 || rawMode === "ACT") {
			mode = "act"
		} else if (rawMode === "plan" || rawMode === "act") {
			mode = rawMode
		} else {
			mode = "act"
		}
		await this.delegate.togglePlanActMode(mode)
		return { data: {} }
	}

	private async handleSearchFiles(request: GrpcRequest): Promise<GrpcResponse> {
		const query = (request.params?.query as string) ?? ""
		const limit = request.params?.limit as number | undefined
		const mentionsRequestId = request.params?.mentionsRequestId as string | undefined
		// Convert proto enum for selectedType: 0 = FILE, 1 = FOLDER
		const rawType = request.params?.selectedType
		let type: string | undefined
		if (rawType === 0 || rawType === "FILE") {
			type = "file"
		} else if (rawType === 1 || rawType === "FOLDER") {
			type = "folder"
		}

		if (this.delegate.searchFiles) {
			const results = await this.delegate.searchFiles(query, type, limit)
			return { data: { results, mentionsRequestId } }
		}
		return { data: { results: [], mentionsRequestId } }
	}

	private async handleSelectFiles(request: GrpcRequest): Promise<GrpcResponse> {
		const allowImages = (request.params?.value as boolean) ?? false
		if (this.delegate.selectFiles) {
			const result = await this.delegate.selectFiles(allowImages)
			// Webview expects StringArrays: values1 = image data URLs, values2 = file paths
			return { data: { values1: result.images, values2: result.files } }
		}
		return { data: { values1: [], values2: [] } }
	}

	private handleScrollToSettings(request: GrpcRequest): GrpcResponse {
		const section = (request.params?.value as string) ?? ""
		// Fire navigate callback to send a typed navigate message to the webview
		this.onNavigateCallback?.("settings", { targetSection: section })
		return { data: { key: "scrollToSettings", value: section } }
	}

	private async handleUpdateSettings(request: GrpcRequest): Promise<GrpcResponse> {
		await this.delegate.updateSettings(request.params ?? {})
		return { data: {} }
	}

	private async handleUpdateAutoApprovalSettings(request: GrpcRequest): Promise<GrpcResponse> {
		await this.delegate.updateAutoApprovalSettings(request.params ?? {})
		return { data: {} }
	}

	private handleInitializeWebview(): GrpcResponse {
		// Push initial state to any subscribers
		const state = this.delegate.getState()
		this.pushState(state)
		return { data: {} }
	}

	// -----------------------------------------------------------------------
	// Auth handlers — return real data from on-disk credentials
	// -----------------------------------------------------------------------

	private handleSubscribeToAuthStatusUpdate(): GrpcResponse {
		// The webview's ClineAuthContext subscribes to auth status updates
		// with an onResponse callback. We store the subscription so we can
		// push auth updates when auth state changes (logout, login).
		// The initial response is returned immediately with current auth state.
		const authInfo = this.delegate.getClineAuthInfo?.()
		if (authInfo?.userInfo) {
			// Resolve uid: the stored id may be empty from a previous broken
			// login. Fall back to extracting the `sub` claim from the JWT.
			let uid = authInfo.userInfo.id
			if (!uid && authInfo.idToken) {
				try {
					const parts = authInfo.idToken.split(".")
					if (parts.length >= 2) {
						const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
						const payload = JSON.parse(Buffer.from(base64, "base64").toString("utf-8"))
						uid = (payload.sub as string) || ""
					}
				} catch {
					// Best-effort JWT extraction
				}
			}
			if (!uid) {
				// No valid user ID — treat as not authenticated
				return { data: {} }
			}
			// Return auth state matching the proto AuthState shape
			return {
				data: {
					user: {
						uid,
						displayName: authInfo.userInfo.displayName,
						email: authInfo.userInfo.email,
					},
				},
			}
		}
		// Not authenticated
		return { data: {} }
	}

	private handleGetUserOrganizations(): GrpcResponse {
		const authInfo = this.delegate.getClineAuthInfo?.()
		if (authInfo?.userInfo?.organizations) {
			return {
				data: {
					organizations: authInfo.userInfo.organizations.map((org) => ({
						organizationId: org.organizationId,
						name: org.name,
						active: org.active,
						memberId: org.memberId,
						roles: org.roles ?? [],
					})),
				},
			}
		}
		return { data: { organizations: [] } }
	}

	private async handleGetUserCredits(): Promise<GrpcResponse> {
		if (this.delegate.fetchUserCredits) {
			try {
				const result = await this.delegate.fetchUserCredits()
				return { data: result }
			} catch (err) {
				Logger.log("[grpc-handler] Failed to fetch user credits:", err instanceof Error ? err.message : String(err))
			}
		}
		// Fallback: return empty balance data so the webview shows "----"
		return { data: { balance: undefined } }
	}

	private async handleGetOrganizationCredits(request: GrpcRequest): Promise<GrpcResponse> {
		const orgId = (request.params?.organizationId as string) ?? ""
		if (orgId && this.delegate.fetchOrganizationCredits) {
			try {
				const result = await this.delegate.fetchOrganizationCredits(orgId)
				return { data: result }
			} catch (err) {
				Logger.log("[grpc-handler] Failed to fetch org credits:", err instanceof Error ? err.message : String(err))
			}
		}
		return { data: { balance: undefined } }
	}

	/**
	 * Handle logout: clear auth credentials from disk and push state update.
	 * After this, the webview will show the sign-in view.
	 */
	private handleAccountLogout(): GrpcResponse {
		if (this.delegate.clearClineAuth) {
			this.delegate.clearClineAuth()
		}
		return { data: {} }
	}

	/**
	 * Handle org switch: update the active organization in stored credentials.
	 * Webview sends: UserOrganizationUpdateRequest { organizationId?: string }
	 */
	private handleSetUserOrganization(request: GrpcRequest): GrpcResponse {
		const orgId = (request.params?.organizationId as string) ?? undefined
		if (this.delegate.setActiveOrganization) {
			this.delegate.setActiveOrganization(orgId || undefined)
		}
		return { data: {} }
	}

	// -----------------------------------------------------------------------
	// Terminal profiles
	// -----------------------------------------------------------------------

	private handleGetAvailableTerminalProfiles(): GrpcResponse {
		// Uses the same function as the VSCode controller — returns
		// platform-specific shell profiles (Default, zsh, bash, etc.)
		const profiles = getAvailableTerminalProfiles()
		return { data: { profiles } }
	}

	// -----------------------------------------------------------------------
	// State persistence handlers
	// -----------------------------------------------------------------------

	/**
	 * Persist telemetry setting to globalState.json.
	 * Webview sends: TelemetrySettingRequest { setting: "enabled" | "disabled" | "unset" }
	 */
	private handleUpdateTelemetrySetting(request: GrpcRequest): GrpcResponse {
		const setting = (request.params?.setting as string) ?? "unset"
		this.delegate.writeGlobalStateKey?.("telemetrySetting", setting)
		return { data: {} }
	}

	/**
	 * Mark the welcome/onboarding view as completed.
	 * Webview sends: BooleanRequest { value: true }
	 */
	private handleSetWelcomeViewCompleted(request: GrpcRequest): GrpcResponse {
		const value = (request.params?.value as boolean) ?? true
		this.delegate.writeGlobalStateKey?.("welcomeViewCompleted", value)
		if (value) {
			this.delegate.writeGlobalStateKey?.("isNewUser", false)
		}
		return { data: {} }
	}

	/**
	 * Mark the current announcement as shown.
	 * Prevents the announcement modal from re-appearing.
	 */
	private handleOnDidShowAnnouncement(): GrpcResponse {
		// Set shouldShowAnnouncement to false in state
		this.delegate.writeGlobalStateKey?.("shouldShowAnnouncement", false)
		return { data: {} }
	}

	/**
	 * Toggle a model ID in the favorites list.
	 * Webview sends: StringRequest { value: "model-id" }
	 */
	private handleToggleFavoriteModel(request: GrpcRequest): GrpcResponse {
		const modelId = (request.params?.value as string) ?? ""
		if (!modelId) return { data: {} }

		const currentFavorites = (this.delegate.readGlobalStateKey?.("favoritedModelIds") as string[]) ?? []
		const idx = currentFavorites.indexOf(modelId)
		let newFavorites: string[]
		if (idx >= 0) {
			// Remove from favorites
			newFavorites = currentFavorites.filter((id) => id !== modelId)
		} else {
			// Add to favorites
			newFavorites = [...currentFavorites, modelId]
		}
		this.delegate.writeGlobalStateKey?.("favoritedModelIds", newFavorites)
		return { data: {} }
	}

	/**
	 * Dismiss a banner by ID. Adds the banner ID to the dismissed set.
	 * Webview sends: StringRequest { value: "banner-id" }
	 */
	private handleDismissBanner(request: GrpcRequest): GrpcResponse {
		const bannerId = (request.params?.value as string) ?? ""
		if (!bannerId) return { data: {} }

		const rawDismissed = (this.delegate.readGlobalStateKey?.("dismissedBanners") as unknown[]) ?? []
		// Normalize mixed formats: convert plain strings (legacy) to { bannerId, dismissedAt } objects
		const dismissed: Array<{ bannerId: string; dismissedAt: number }> = rawDismissed.map((entry) => {
			if (typeof entry === "string") {
				return { bannerId: entry, dismissedAt: 0 }
			}
			return entry as { bannerId: string; dismissedAt: number }
		})
		if (!dismissed.some((d) => d.bannerId === bannerId)) {
			this.delegate.writeGlobalStateKey?.("dismissedBanners", [...dismissed, { bannerId, dismissedAt: Date.now() }])
		}
		return { data: {} }
	}

	/**
	 * Update a banner version (info/model/cli).
	 * Persists the version number so the banner is not shown again.
	 */
	private handleUpdateBannerVersion(request: GrpcRequest, key: string): GrpcResponse {
		const version = (request.params?.value as number) ?? 0
		this.delegate.writeGlobalStateKey?.(key, version)
		return { data: {} }
	}

	/**
	 * Reset state (clear settings and optionally start fresh).
	 * Webview sends: ResetStateRequest { global: boolean }
	 */
	private async handleResetState(request: GrpcRequest): Promise<GrpcResponse> {
		// The webview sends { global: true } to reset global state
		// For SDK mode, we clear key settings but preserve task history
		const resetGlobal = (request.params?.global as boolean) ?? false
		if (resetGlobal) {
			// Clear provider-specific settings
			this.delegate.writeGlobalStateKey?.("apiProvider", undefined)
			this.delegate.writeGlobalStateKey?.("apiModelId", undefined)
			this.delegate.writeGlobalStateKey?.("actModeApiProvider", undefined)
			this.delegate.writeGlobalStateKey?.("planModeApiProvider", undefined)
			this.delegate.writeGlobalStateKey?.("customInstructions", undefined)
			this.delegate.writeGlobalStateKey?.("favoritedModelIds", [])
			this.delegate.writeGlobalStateKey?.("dismissedBanners", [])
			this.delegate.writeGlobalStateKey?.("welcomeViewCompleted", false)
			this.delegate.writeGlobalStateKey?.("isNewUser", true)
		}
		return { data: {} }
	}

	/**
	 * Toggle the favorite flag on a task history item.
	 * Webview sends: TaskFavoriteRequest { id: "task-id", isFavorite: boolean }
	 */
	private async handleToggleTaskFavorite(request: GrpcRequest): Promise<GrpcResponse> {
		// Proto field names are taskId and isFavorited (not id/isFavorite)
		const taskId = (request.params?.taskId as string) ?? (request.params?.id as string) ?? ""
		const isFavorite = (request.params?.isFavorited as boolean) ?? (request.params?.isFavorite as boolean) ?? false
		if (taskId && this.delegate.toggleTaskFavorite) {
			await this.delegate.toggleTaskFavorite(taskId, isFavorite)
		}
		return { data: {} }
	}

	// -----------------------------------------------------------------------
	// Platform operation handlers
	// -----------------------------------------------------------------------

	/**
	 * Open a URL in the default browser.
	 * Webview sends: StringRequest { value: "https://..." }
	 */
	private async handleOpenUrl(request: GrpcRequest): Promise<GrpcResponse> {
		const url = (request.params?.value as string) ?? ""
		if (url && this.delegate.openUrl) {
			await this.delegate.openUrl(url)
		}
		return { data: {} }
	}

	/**
	 * Open a file in the editor. Handles openFile, openFileRelativePath,
	 * openImage, and openMention — all take StringRequest { value: path }.
	 */
	private async handleOpenFile(request: GrpcRequest): Promise<GrpcResponse> {
		const filePath = (request.params?.value as string) ?? ""
		if (filePath && this.delegate.openFile) {
			await this.delegate.openFile(filePath)
		}
		return { data: {} }
	}

	/**
	 * Copy text to the system clipboard.
	 * Webview sends: StringRequest { value: "text to copy" }
	 */
	private async handleCopyToClipboard(request: GrpcRequest): Promise<GrpcResponse> {
		const text = (request.params?.value as string) ?? ""
		if (this.delegate.copyToClipboard) {
			await this.delegate.copyToClipboard(text)
		}
		return { data: {} }
	}

	/**
	 * Open the MCP settings file in the editor.
	 */
	private async handleOpenMcpSettings(): Promise<GrpcResponse> {
		if (this.delegate.openMcpSettings) {
			await this.delegate.openMcpSettings()
		}
		return { data: {} }
	}

	// -----------------------------------------------------------------------
	// Data query handlers
	// -----------------------------------------------------------------------

	/**
	 * Convert absolute/URI paths to workspace-relative paths.
	 * Webview sends: RelativePathsRequest { uris: string[] }
	 * Returns: RelativePaths { paths: string[] }
	 */
	private async handleGetRelativePaths(request: GrpcRequest): Promise<GrpcResponse> {
		const uris = (request.params?.uris as string[]) ?? []
		if (this.delegate.getRelativePaths) {
			const paths = await this.delegate.getRelativePaths(uris)
			return { data: { paths } }
		}
		// Fallback: return the URIs as-is (best effort)
		return { data: { paths: uris } }
	}

	/**
	 * Check if a URL points to an image.
	 * Webview sends: StringRequest { value: "https://..." }
	 * Returns: IsImageUrl { isImage: boolean }
	 */
	private async handleCheckIsImageUrl(request: GrpcRequest): Promise<GrpcResponse> {
		const url = (request.params?.value as string) ?? ""
		if (this.delegate.checkIsImageUrl) {
			const isImage = await this.delegate.checkIsImageUrl(url)
			return { data: { isImage } }
		}
		// Fallback: check by extension
		const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"]
		const isImage = imageExtensions.some((ext) => url.toLowerCase().endsWith(ext))
		return { data: { isImage } }
	}

	/**
	 * Get the total disk size of all task storage.
	 * Returns: Int64 { value: number } (bytes)
	 */
	private async handleGetTotalTasksSize(): Promise<GrpcResponse> {
		if (this.delegate.getTotalTasksSize) {
			const size = await this.delegate.getTotalTasksSize()
			return { data: { value: size } }
		}
		return { data: { value: 0 } }
	}

	/**
	 * Export a task by ID (e.g., save to file).
	 * Webview sends: StringRequest { value: "task-id" }
	 */
	private async handleExportTaskWithId(request: GrpcRequest): Promise<GrpcResponse> {
		const taskId = (request.params?.value as string) ?? ""
		if (taskId && this.delegate.exportTaskWithId) {
			await this.delegate.exportTaskWithId(taskId)
		}
		return { data: {} }
	}

	// -----------------------------------------------------------------------
	// Model discovery handlers
	// -----------------------------------------------------------------------

	/**
	 * Fetch available models from a local Ollama server.
	 * Webview sends: StringRequest { value: "http://localhost:11434" }
	 * Returns: StringArray { values: string[] }
	 */
	private async handleGetOllamaModels(request: GrpcRequest): Promise<GrpcResponse> {
		const endpoint = (request.params?.value as string) ?? "http://localhost:11434"
		if (this.delegate.getOllamaModels) {
			const models = await this.delegate.getOllamaModels(endpoint)
			return { data: { values: models } }
		}
		return { data: { values: [] } }
	}

	/**
	 * Fetch available models from a local LM Studio server.
	 * Webview sends: StringRequest { value: "http://localhost:1234" }
	 * Returns: StringArray { values: string[] }
	 */
	private async handleGetLmStudioModels(request: GrpcRequest): Promise<GrpcResponse> {
		const endpoint = (request.params?.value as string) ?? "http://localhost:1234"
		if (this.delegate.getLmStudioModels) {
			const models = await this.delegate.getLmStudioModels(endpoint)
			return { data: { values: models } }
		}
		return { data: { values: [] } }
	}

	// -----------------------------------------------------------------------
	// Cline model discovery handler
	// -----------------------------------------------------------------------

	/**
	 * Fetch Cline models from the API and return in protobuf format.
	 * Tries disk cache first, falls back to API call.
	 * Returns: OpenRouterCompatibleModelInfo { models: Record<string, OpenRouterModelInfo> }
	 */
	private async handleRefreshClineModels(): Promise<GrpcResponse> {
		try {
			// Try disk cache first (fast, no network)
			const cached = await readClineModelsFromCache()
			if (cached && Object.keys(cached).length > 0) {
				return { data: { models: toProtobufModels(cached) } }
			}

			// No cache — fetch from Cline API directly
			const apiBaseUrl = "https://api.cline.bot"
			const response = await globalThis.fetch(`${apiBaseUrl}/api/v1/ai/cline/models`)
			if (!response.ok) {
				throw new Error(`Cline models API returned ${response.status}`)
			}
			const json = (await response.json()) as {
				data?: Array<{
					id: string
					context_length?: number
					top_provider?: { max_completion_tokens?: number }
					pricing?: { prompt?: string; completion?: string }
					architecture?: { modality?: string | string[] }
					supported_parameters?: string[]
				}>
			}
			if (!Array.isArray(json?.data)) {
				throw new Error("Invalid response from Cline models API")
			}

			// Convert raw API response to ModelInfo records
			const models: Record<string, ModelInfo> = {}
			for (const raw of json.data) {
				const parsePrice = (p: unknown) => {
					if (p === undefined || p === null || p === "") return undefined
					const n = Number.parseFloat(String(p))
					return Number.isNaN(n) ? undefined : n * 1_000_000
				}
				const modality = raw.architecture?.modality
				const supportsImages = Array.isArray(modality)
					? modality.includes("image")
					: typeof modality === "string" && modality.includes("image")
				const supportThinking = raw.supported_parameters?.some(
					(p: string) => p === "include_reasoning" || p === "reasoning",
				)
				models[raw.id] = {
					maxTokens: raw.top_provider?.max_completion_tokens ?? 0,
					contextWindow: raw.context_length ?? 0,
					supportsImages,
					supportsPromptCache: false,
					inputPrice: parsePrice(raw.pricing?.prompt) ?? 0,
					outputPrice: parsePrice(raw.pricing?.completion) ?? 0,
					thinkingConfig: supportThinking ? { maxBudget: 16000 } : undefined,
				}
			}

			if (Object.keys(models).length > 0) {
				return { data: { models: toProtobufModels(models) } }
			}
		} catch (err) {
			Logger.log("[grpc-handler] Failed to refresh Cline models:", err instanceof Error ? err.message : String(err))
		}
		// Return empty models — the webview will use fallback model list
		return { data: { models: {} } }
	}

	// -----------------------------------------------------------------------
	// MCP servers handler
	// -----------------------------------------------------------------------

	/**
	 * Read MCP servers from disk and return in proto-compatible format.
	 * The webview's convertProtoMcpServersToMcpServers expects { mcpServers: [...] }
	 * where each server has proto-shaped fields (status as numeric enum, etc.)
	 */
	private handleGetLatestMcpServers(): GrpcResponse {
		if (this.delegate.getMcpServers) {
			const mcpServers = this.delegate.getMcpServers()
			return { data: { mcpServers } }
		}
		return { data: { mcpServers: [] } }
	}

	// -----------------------------------------------------------------------
	// MCP marketplace handler
	// -----------------------------------------------------------------------

	/**
	 * Read the MCP marketplace catalog from the local disk cache.
	 * Returns: McpMarketplaceCatalog { items: [...] }
	 * This is used by the bridge for subscribeToMcpMarketplaceCatalog streaming.
	 */
	async getMcpMarketplaceCatalog(): Promise<GrpcResponse> {
		try {
			const catalog = await readMcpMarketplaceCatalogFromCache()
			if (catalog?.items?.length) {
				return { data: catalog }
			}
		} catch (err) {
			Logger.log(
				"[grpc-handler] Failed to read MCP marketplace catalog from cache:",
				err instanceof Error ? err.message : String(err),
			)
		}
		return { data: { items: [] } }
	}

	// -----------------------------------------------------------------------
	// Account login handler
	// -----------------------------------------------------------------------

	/**
	 * Handle login click: initiate OAuth flow.
	 * Delegates to the controller's OAuth handler.
	 */
	private async handleAccountLoginClicked(): Promise<GrpcResponse> {
		if (this.delegate.performClineOAuth) {
			await this.delegate.performClineOAuth()
			return { data: { value: "OAuth flow initiated" } }
		}
		return { error: "OAuth not supported in this environment" }
	}
}

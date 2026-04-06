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

import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"

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
	if (!isNaN(num) && PROTO_PROVIDER_NUM_TO_APP[num] !== undefined) {
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
	const providerFields = [
		"planModeApiProvider",
		"actModeApiProvider",
		"apiProvider",
	]
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
	getClineAuthInfo?(): { idToken: string; userInfo: { id: string; email: string; displayName: string; organizations?: Array<{ active: boolean; organizationId: string; name: string; memberId: string; roles?: string[] }> } } | null
}

// ---------------------------------------------------------------------------
// GrpcHandler
// ---------------------------------------------------------------------------

export class GrpcHandler {
	private delegate: GrpcHandlerDelegate
	private stateSubscriptions = new Map<string, SubscriptionCallback>()
	private partialMessageSubscriptions = new Map<string, SubscriptionCallback>()
	private nextSubscriptionId = 0

	constructor(delegate: GrpcHandlerDelegate) {
		this.delegate = delegate
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
					return this.handleGetUserCredits()
				case "getOrganizationCredits":
					return this.handleGetOrganizationCredits()

				// ---- Non-critical methods (return empty) ----
				case "getAvailableTerminalProfiles":
				case "updateTelemetrySetting":
				case "captureOnboardingProgress":
				case "setWelcomeViewCompleted":
				case "resetState":
				case "toggleFavoriteModel":
				case "refreshOpenRouterModelsRpc":
				case "refreshLiteLlmModelsRpc":
				case "refreshBasetenModelsRpc":
				case "refreshVercelAiGatewayModelsRpc":
				case "refreshClineModelsRpc":
				case "refreshGroqModelsRpc":
				case "refreshRequestyModels":
				case "refreshHuggingFaceModels":
				case "refreshHicapModels":
				case "refreshOcaModels":
				case "getOllamaModels":
				case "getLmStudioModels":
				case "getVsCodeLmModels":
				case "getSapAiCoreModels":
				case "getAihubmixModels":
				case "refreshOpenAiModels":
				case "getLatestMcpServers":
				case "subscribeToMcpServers":
				case "subscribeToMcpButtonClicked":
				case "subscribeToHistoryButtonClicked":
				case "subscribeToChatButtonClicked":
				case "subscribeToSettingsButtonClicked":
				case "subscribeToWorktreesButtonClicked":
				case "subscribeToAccountButtonClicked":
				case "subscribeToOpenRouterModels":
				case "subscribeToLiteLlmModels":
				case "subscribeToMcpMarketplaceCatalog":
				case "subscribeToRelinquishControl":
				case "subscribeToShowWebview":
				case "subscribeToAddToInput":
				case "onDidShowAnnouncement":
				case "openFile":
				case "openFileRelativePath":
				case "openImage":
				case "openMention":
				case "openUrl":
				case "openWalkthrough":
				case "copyToClipboard":
				case "selectFiles":
				case "searchFiles":
				case "searchCommits":
				case "getRelativePaths":
				case "ifFileExistsRelativePath":
				case "openDiskConversationHistory":
				case "openFocusChainFile":
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
				case "openMcpSettings":
				case "restartMcpServer":
				case "deleteMcpServer":
				case "toggleToolAutoApprove":
				case "toggleMcpServer":
				case "authenticateMcpServer":
				case "updateMcpTimeout":
				case "addRemoteMcpServer":
				case "refreshMcpMarketplace":
				case "downloadMcp":
				case "accountLoginClicked":
				case "accountLogoutClicked":
				case "openAiCodexSignIn":
				case "openAiCodexSignOut":
				case "openrouterAuthClicked":
				case "requestyAuthClicked":
				case "hicapAuthClicked":
				case "ocaAccountLoginClicked":
				case "ocaAccountLogoutClicked":
				case "ocaSubscribeToAuthStatusUpdate":
				case "setUserOrganization":
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
				case "scrollToSettings":
				case "openInBrowser":
				case "checkIsImageUrl":
				case "fetchOpenGraphData":
				case "dismissBanner":
				case "updateInfoBannerVersion":
				case "updateModelBannerVersion":
				case "updateCliBannerVersion":
				case "installClineCli":
				case "refreshRemoteConfig":
				case "testOtelConnection":
				case "testPromptUploading":
				case "condense":
				case "reportBug":
				case "taskFeedback":
				case "taskCompletionViewChanges":
				case "explainChanges":
				case "exportTaskWithId":
				case "getTotalTasksSize":
				case "cancelBackgroundCommand":
				case "toggleTaskFavorite":
				case "getProcessInfo":
					return { data: {} }

				default:
					// Unknown method — return empty response (not error)
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
		const offset = request.params?.offset as number | undefined
		const limit = request.params?.limit as number | undefined
		const history = this.delegate.getTaskHistory(offset, limit)
		return { data: { history } }
	}

	private async handleShowTaskWithId(request: GrpcRequest): Promise<GrpcResponse> {
		const id = (request.params?.value as string) ?? ""
		await this.delegate.showTaskWithId(id)
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
		const mode = (request.params?.mode as Mode) ?? "act"
		await this.delegate.togglePlanActMode(mode)
		return { data: {} }
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
		const authInfo = this.delegate.getClineAuthInfo?.()
		if (authInfo?.userInfo) {
			// Return auth state matching the proto AuthState shape
			return {
				data: {
					user: {
						uid: authInfo.userInfo.id,
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
					})),
				},
			}
		}
		return { data: { organizations: [] } }
	}

	private handleGetUserCredits(): GrpcResponse {
		// We don't have credit info on disk — return a placeholder
		// The webview will show "Credits: —" which is acceptable
		return { data: { credits: undefined } }
	}

	private handleGetOrganizationCredits(): GrpcResponse {
		// Same as getUserCredits — no credit info on disk
		return { data: { credits: undefined } }
	}
}

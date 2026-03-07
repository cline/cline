/**
 * ClineAgent - Decoupled ACP Agent implementation for Cline CLI.
 *
 * This class implements the ACP (Agent Client Protocol) Agent interface,
 * allowing Cline to be used programmatically without stdio dependency.
 * It uses a callback pattern for permission requests and EventEmitters
 * for session updates, enabling embedding in other Node.js applications.
 *
 * For stdio-based ACP communication, use the AcpAgent wrapper class.
 *
 * @module acp
 */

import type * as acp from "@agentclientprotocol/sdk"
import { PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk"
import type { ClineMessageChange } from "@core/task/message-state"
import type { ApiProvider } from "@shared/api"
import {
	anthropicDefaultModelId,
	anthropicModels,
	bedrockDefaultModelId,
	bedrockModels,
	deepSeekDefaultModelId,
	deepSeekModels,
	geminiDefaultModelId,
	geminiModels,
	groqDefaultModelId,
	groqModels,
	mistralDefaultModelId,
	mistralModels,
	moonshotDefaultModelId,
	moonshotModels,
	openAiCodexDefaultModelId,
	openAiNativeDefaultModelId,
	openAiNativeModels,
	xaiDefaultModelId,
	xaiModels,
} from "@shared/api"
import type { ClineAsk, ClineMessage as ClineMessageType } from "@shared/ExtensionMessage"
import { CLI_ONLY_COMMANDS, VSCODE_ONLY_COMMANDS } from "@shared/slashCommands"
import { getProviderModelIdKey } from "@shared/storage/provider-keys"
import { ClineEndpoint } from "@/config.js"
import { Controller } from "@/core/controller"
import { getAvailableSlashCommands } from "@/core/controller/slash/getAvailableSlashCommands"
import { setRuntimeHooksDir } from "@/core/storage/disk"
import { StateManager } from "@/core/storage/StateManager"
import { AuthHandler } from "@/hosts/external/AuthHandler.js"
import { ExternalCommentReviewController } from "@/hosts/external/ExternalCommentReviewController.js"
import { ExternalWebviewProvider } from "@/hosts/external/ExternalWebviewProvider.js"
import { HostProvider } from "@/hosts/host-provider.js"
import { FileEditProvider } from "@/integrations/editor/FileEditProvider"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { StandaloneTerminalManager } from "@/integrations/terminal/index.js"
import { AuthService } from "@/services/auth/AuthService.js"
import { Logger } from "@/shared/services/Logger.js"
import type { Mode } from "@/shared/storage/types"
import { openExternal } from "@/utils/env"
import { version as AGENT_VERSION } from "../../package.json"
import { ACPDiffViewProvider } from "../acp/ACPDiffViewProvider.js"
import { ACPHostBridgeClientProvider } from "../acp/ACPHostBridgeClientProvider.js"
import { AcpTerminalManager } from "../acp/AcpTerminalManager.js"
import { isAuthConfigured } from "../utils/auth"
import { fetchOpenRouterModels, usesOpenRouterModels } from "../utils/openrouter-models"
import { CliContextResult, initializeCliContext } from "../vscode-context.js"
import { ClineSessionEmitter } from "./ClineSessionEmitter.js"
import { translateMessage } from "./messageTranslator.js"
import { handlePermissionResponse } from "./permissionHandler.js"
import type { ClineAcpSession, ClineAgentOptions, PermissionHandler } from "./public-types.js"
import { AcpSessionStatus } from "./public-types.js"
import { type AcpSessionState } from "./types.js"

// Map providers to their static model lists and defaults (copied from ModelPicker.tsx)
const providerModels: Record<string, { models: Record<string, unknown>; defaultId: string }> = {
	anthropic: { models: anthropicModels, defaultId: anthropicDefaultModelId },
	"openai-native": { models: openAiNativeModels, defaultId: openAiNativeDefaultModelId },
	gemini: { models: geminiModels, defaultId: geminiDefaultModelId },
	bedrock: { models: bedrockModels, defaultId: bedrockDefaultModelId },
	deepseek: { models: deepSeekModels, defaultId: deepSeekDefaultModelId },
	mistral: { models: mistralModels, defaultId: mistralDefaultModelId },
	moonshot: { models: moonshotModels, defaultId: moonshotDefaultModelId },
	groq: { models: groqModels, defaultId: groqDefaultModelId },
	xai: { models: xaiModels, defaultId: xaiDefaultModelId },
}

function hasStaticModels(provider: string): boolean {
	return provider in providerModels
}

function getModelList(provider: string): string[] {
	if (!hasStaticModels(provider)) return []
	return Object.keys(providerModels[provider].models)
}

/**
 * Cline's implementation of the ACP Agent interface.
 *
 * This agent bridges the ACP protocol with Cline's core Controller,
 * translating ACP requests into Controller operations and emitting
 * session updates via EventEmitters.
 *
 * This class is decoupled from the stdio connection, enabling:
 * - Programmatic usage without stdio dependency
 * - Running multiple concurrent sessions
 * - Handling ACP events via EventEmitter pattern
 *
 * For stdio-based ACP communication, use the AcpAgent wrapper class.
 */
export class ClineAgent implements acp.Agent {
	private readonly options: ClineAgentOptions
	private readonly ctx: CliContextResult

	/** Map of active sessions by session ID */
	public readonly sessions: Map<string, ClineAcpSession> = new Map()

	/** WeakMap to associate ClineAcpSession with its Controller without exposing it to consumers */
	readonly #sessionControllers = new WeakMap<ClineAcpSession, Controller>()

	/** Runtime state for active sessions */
	private readonly sessionStates: Map<string, AcpSessionState> = new Map()

	/** Per-session event emitters for session updates */
	private readonly sessionEmitters: Map<string, ClineSessionEmitter> = new Map()

	/** Permission handler callback for requesting user permission */
	private permissionHandler?: PermissionHandler

	/** Client capabilities received during initialization */
	private clientCapabilities?: acp.ClientCapabilities

	/** Track last sent content for partial messages to compute deltas */
	private partialMessageLastContent: Map<number, string> = new Map()

	/** Track last sent content per say/ask subtype within a prompt cycle.
	 * Used as a fallback when the final non-partial message arrives with a
	 * different timestamp than the partial streaming messages (due to a SET
	 * event that replaces the streaming message with a new one). This prevents
	 * re-emitting content that was already fully streamed. */
	private partialMessageLastContentByType: Map<string, string> = new Map()

	/** Map message timestamps to toolCallIds to avoid creating duplicate tool calls during streaming */
	private messageToToolCallId: Map<number, string> = new Map()

	/** Current active session ID for use by DiffViewProvider */
	private currentActiveSessionId: string | undefined

	/** Shared WebviewProvider instance for auth and other operations */
	private webviewProvider: ReturnType<typeof HostProvider.get.prototype.createWebviewProvider> | undefined

	constructor(options: ClineAgentOptions) {
		this.options = options
		setRuntimeHooksDir(options.hooksDir)
		this.ctx = initializeCliContext({ clineDir: options.clineDir })
	}

	/**
	 * Set the permission handler callback.
	 *
	 * This handler is called when the agent needs permission for a tool call.
	 * The handler should present the request to the user and call the resolve
	 * callback with their response.
	 *
	 * @param handler - The permission handler callback
	 */
	setPermissionHandler(handler: PermissionHandler): void {
		this.permissionHandler = handler
	}

	/**
	 * Get the event emitter for a session.
	 *
	 * Use this to subscribe to session events like agent_message_chunk,
	 * tool_call, etc.
	 *
	 * @param sessionId - The session ID
	 * @returns The session's event emitter
	 */
	emitterForSession(sessionId: string): ClineSessionEmitter {
		let emitter = this.sessionEmitters.get(sessionId)
		if (!emitter) {
			emitter = new ClineSessionEmitter()
			this.sessionEmitters.set(sessionId, emitter)
		}
		return emitter
	}

	/**
	 * Initialize the agent and return its capabilities.
	 *
	 * This is the first method called by the client after establishing
	 * the connection. The agent returns its protocol version and capabilities.
	 */
	async initialize(params: acp.InitializeRequest, connection?: acp.AgentSideConnection): Promise<acp.InitializeResponse> {
		this.clientCapabilities = params.clientCapabilities
		this.initializeHostProvider(this.clientCapabilities, connection)
		await ClineEndpoint.initialize(this.ctx.EXTENSION_DIR)
		await StateManager.initialize(this.ctx.storageContext)

		return {
			protocolVersion: PROTOCOL_VERSION,
			agentCapabilities: {
				loadSession: false,
				promptCapabilities: {
					image: true,
					audio: false,
					embeddedContext: true,
				},
				mcpCapabilities: {
					http: true,
					sse: false, // deprecated by MCP spec
				},
			},
			agentInfo: {
				name: "cline",
				version: AGENT_VERSION,
			},
			authMethods: [
				{
					id: "cline-oauth",
					name: "Sign in with Cline",
					description: "Authenticate with your Cline account via browser OAuth",
				},
				{
					id: "openai-codex-oauth",
					name: "Sign in with ChatGPT",
					description: "Authenticate with your ChatGPT Plus/Pro/Team subscription",
				},
			],
		}
	}

	/**
	 * Initialize the host provider with optional connection for ACP mode.
	 *
	 * When used with the AcpAgent wrapper, a connection is provided for
	 * host bridge operations. When used programmatically, connection is
	 * undefined and standalone providers are used.
	 *
	 * @param clientCapabilities - Client capabilities from initialization
	 * @param connection - Optional ACP connection for host bridge operations
	 */
	initializeHostProvider(clientCapabilities?: acp.ClientCapabilities, connection?: acp.AgentSideConnection): void {
		const hostBridgeClientProvider = new ACPHostBridgeClientProvider(
			clientCapabilities,
			() => this.currentActiveSessionId,
			() => this.sessions.get(this.currentActiveSessionId ?? "")?.cwd ?? process.cwd(),
			AGENT_VERSION,
		)

		HostProvider.initialize(
			() => new ExternalWebviewProvider(this.ctx.extensionContext),
			() => {
				if (clientCapabilities?.fs && connection) {
					return new ACPDiffViewProvider(connection, clientCapabilities, () => this.currentActiveSessionId)
				}
				// Fallback for programmatic use
				return new FileEditProvider()
			},
			() => new ExternalCommentReviewController(),
			() => {
				if (clientCapabilities?.terminal && connection) {
					return new AcpTerminalManager(connection, clientCapabilities, () => this.currentActiveSessionId)
				}
				// Fallback for programmatic use
				return new StandaloneTerminalManager()
			},
			hostBridgeClientProvider,
			(message: string) => Logger.info(message),
			async (path: string) => {
				return AuthHandler.getInstance().getCallbackUrl(path)
			},
			async () => "", // get binary location not needed in ACP mode
			this.ctx.EXTENSION_DIR,
			this.ctx.DATA_DIR,
		)
	}

	/**
	 * Create a new session.
	 *
	 * A session represents a conversation/task with the agent. The client
	 * provides the working directory and optionally MCP servers to use.
	 */
	async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
		// Check if authentication is required
		const isAuthenticated = await isAuthConfigured()
		if (!isAuthenticated) {
			throw RequestError.authRequired()
		}

		const sessionId = crypto.randomUUID()

		Logger.debug("[ClineAgent] newSession called:", {
			sessionId,
			cwd: params.cwd,
			mcpServers: params.mcpServers?.length ?? 0,
		})

		// Create Controller for this session
		const controller = new Controller(this.ctx.extensionContext)

		// Create session record with all resources
		const session: ClineAcpSession = {
			sessionId,
			cwd: params.cwd,
			mode: (await controller.getStateToPostToWebview()).mode,
			mcpServers: params.mcpServers ?? [],
			createdAt: Date.now(),
			lastActivityAt: Date.now(),
		}

		this.#sessionControllers.set(session, controller)

		this.sessions.set(sessionId, session)

		// Initialize session state
		const sessionState: AcpSessionState = {
			sessionId,
			status: AcpSessionStatus.Idle,
			pendingToolCalls: new Map(),
		}

		this.sessionStates.set(sessionId, sessionState)

		// Send available slash commands to the client
		// This is done asynchronously after session creation
		await this.sendAvailableCommands(sessionId, controller).catch((error) => {
			Logger.debug("[ClineAgent] Failed to send available commands:", error)
		})

		// Get current model configuration for the response
		const modelState = await this.getSessionModelState(session.mode)

		return {
			sessionId,
			modes: {
				availableModes: [
					{ id: "plan", name: "Plan", description: "Gather information and create a detailed plan" },
					{ id: "act", name: "Act", description: "Execute actions to accomplish the task" },
				],
				currentModeId: session.mode,
			},
			models: modelState,
		}
	}

	/**
	 * Get the current model state for ACP responses.
	 * Returns available models and the current model ID based on the session mode.
	 */
	private async getSessionModelState(mode: Mode): Promise<acp.SessionModelState> {
		const stateManager = StateManager.get()

		// Get current provider and model for the mode
		const providerKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
		const currentProvider = stateManager.getGlobalSettingsKey(providerKey) as ApiProvider | undefined

		// Use provider-specific model ID key (e.g., cline uses actModeOpenRouterModelId)
		const modelKey = currentProvider ? getProviderModelIdKey(currentProvider, mode) : null
		const currentModelId = modelKey ? stateManager.getGlobalSettingsKey(modelKey) : undefined

		// Build the current model ID in provider/model format
		const currentFullModelId =
			currentProvider && currentModelId ? `${currentProvider}/${currentModelId}` : currentProvider || ""

		// Get available models based on provider
		let modelIds: string[] = []

		if (currentProvider) {
			if (usesOpenRouterModels(currentProvider)) {
				// Fetch OpenRouter models (async)
				modelIds = await fetchOpenRouterModels()
			} else if (hasStaticModels(currentProvider)) {
				// Use static model list
				modelIds = getModelList(currentProvider)
			}
		}

		// Convert to ACP ModelInfo format with provider prefix
		const availableModels: acp.ModelInfo[] = modelIds.map((modelId) => ({
			modelId: currentProvider ? `${currentProvider}/${modelId}` : modelId,
			name: modelId,
		}))

		return {
			currentModelId: currentFullModelId,
			availableModels,
		}
	}

	/**
	 * Set the model for a session.
	 *
	 * This method allows changing the model for either plan or act mode.
	 * The modelId format is "provider/modelId" (e.g., "anthropic/claude-3-5-sonnet-20241022").
	 *
	 * @experimental This is an unstable API that may change.
	 */
	async unstable_setSessionModel(params: acp.SetSessionModelRequest): Promise<acp.SetSessionModelResponse> {
		const session = this.sessions.get(params.sessionId)

		if (!session) {
			throw new Error(`Session not found: ${params.sessionId}`)
		}

		Logger.debug("[ClineAgent] unstable_setSessionModel called:", {
			sessionId: params.sessionId,
			modelId: params.modelId,
		})

		// Parse the modelId format: "provider/modelId"
		const slashIndex = params.modelId.indexOf("/")
		if (slashIndex === -1) {
			throw new Error(`Invalid modelId format: ${params.modelId}. Expected "provider/modelId".`)
		}

		const provider = params.modelId.substring(0, slashIndex) as ApiProvider
		const modelId = params.modelId.substring(slashIndex + 1)

		const stateManager = StateManager.get()

		// Update provider for both modes
		stateManager.setGlobalState("actModeApiProvider", provider)
		stateManager.setGlobalState("planModeApiProvider", provider)

		// Update model ID using provider-specific keys (e.g., cline uses actModeOpenRouterModelId)
		const actProviderModelKey = getProviderModelIdKey(provider, "act")
		if (actProviderModelKey) {
			stateManager.setGlobalState(actProviderModelKey, modelId)
		}
		const planProviderModelKey = getProviderModelIdKey(provider, "plan")
		if (planProviderModelKey) {
			stateManager.setGlobalState(planProviderModelKey, modelId)
		}

		// Store the model override in the session for both modes
		session.actModeModelId = params.modelId
		session.planModeModelId = params.modelId

		session.lastActivityAt = Date.now()

		// Flush state changes
		await stateManager.flushPendingState()

		return {}
	}

	/**
	 * Handle a user prompt.
	 *
	 * This is the main entry point for user interaction. The agent
	 * processes the prompt and sends updates back via sessionUpdate.
	 *
	 * The prompt flow:
	 * 1. Extract content from the ACP prompt (text, images, files)
	 * 2. Set up internal cline state subsription
	 * 3. Initialize or continue cline task
	 * 4. Translate ClineMessages to ACP SessionUpdates
	 * 5. Handle permission requests for tools/commands
	 * 6. Return when cline task completes, is cancelled, or needs user input
	 */
	async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
		const session = this.sessions.get(params.sessionId)
		const sessionState = this.sessionStates.get(params.sessionId)

		if (!session || !sessionState) {
			throw new Error(`Session not found: ${params.sessionId}`)
		}

		if (sessionState.status === AcpSessionStatus.Processing) {
			throw new Error(`Session ${params.sessionId} is already processing a prompt`)
		}

		const controller = this.#sessionControllers.get(session)
		if (!controller) {
			throw new Error("Controller not initialized for session. This is a bug in the ACP agent setup.")
		}

		Logger.debug("[ClineAgent] prompt called:", {
			sessionId: params.sessionId,
			promptLength: params.prompt.length,
		})

		// Mark session as processing and set as current active session
		sessionState.status = AcpSessionStatus.Processing
		session.lastActivityAt = Date.now()
		this.currentActiveSessionId = params.sessionId

		// Clear delta tracking state for new prompt cycle
		this.partialMessageLastContent.clear()
		this.partialMessageLastContentByType.clear()
		this.messageToToolCallId.clear()

		// Track cleanup functions for subscriptions
		const cleanupFunctions: (() => void)[] = []

		// Promise that resolves when task completes, is cancelled, or needs input
		let resolvePrompt: (response: acp.PromptResponse) => void
		const promptPromise = new Promise<acp.PromptResponse>((resolve) => {
			resolvePrompt = resolve
		})

		// Track if we've already resolved/rejected (object for pass-by-reference)
		const promptResolved = { value: false }

		try {
			// Extract text content from prompt
			const textContent = params.prompt
				.filter((block): block is acp.TextContent & { type: "text" } => block.type === "text")
				.map((block) => block.text)
				.join("\n")

			// Extract image content as base64 data URLs
			const imageContent = params.prompt
				.filter((block): block is acp.ImageContent & { type: "image" } => block.type === "image")
				.map((block) => `data:${block.mimeType || "image/png"};base64,${block.data}`)

			// Extract file resources (embedded resources)
			const fileResources = params.prompt
				.filter((block): block is acp.EmbeddedResource & { type: "resource" } => block.type === "resource")
				.map((block) => block.resource.uri)

			// Helper to wire up the clineMessages subscription
			const subscribeToTaskMessages = (task: NonNullable<typeof controller.task>) => {
				const onClineMessagesChanged = (change: ClineMessageChange) => {
					this.handleClineMessagesChanged(params.sessionId, sessionState, change, resolvePrompt, promptResolved).catch(
						(error) => {
							Logger.debug("[ClineAgent] Error handling clineMessagesChanged:", error)
						},
					)
				}
				task.messageStateHandler.on("clineMessagesChanged", onClineMessagesChanged)
				cleanupFunctions.push(() => {
					task.messageStateHandler.off("clineMessagesChanged", onClineMessagesChanged)
				})
			}

			if (controller.task) {
				// Case 2: Existing task — this prompt is another conversation turn.
				// Subscribe BEFORE responding so we don't miss any messages that fire
				// synchronously or very quickly after handleWebviewAskResponse unblocks
				// the task's pWaitFor loop.
				Logger.debug("[ClineAgent] Continuing existing task:", controller.task.taskId)
				subscribeToTaskMessages(controller.task)
				await controller.task.handleWebviewAskResponse("messageResponse", textContent, imageContent, fileResources)
			} else {
				// Case 1: No active task — start a brand-new task.
				Logger.debug("[ClineAgent] Starting new task")
				await controller.initTask(textContent, imageContent, fileResources)

				// controller.task is set synchronously inside initTask (before startTask is
				// called), so we can subscribe right after initTask returns.
				if (controller.task) {
					subscribeToTaskMessages(controller.task)
				}
			}

			// Return the promise that will resolve when task completes
			return await promptPromise
		} catch (error) {
			if (!promptResolved.value) {
				promptResolved.value = true
				// Send error as session update before returning
				await this.emitSessionUpdate(params.sessionId, {
					sessionUpdate: "agent_message_chunk",
					content: {
						type: "text",
						text: `Error: ${error instanceof Error ? error.message : String(error)}`,
					},
				})
				return { stopReason: "error" as acp.StopReason }
			}
			throw error
		} finally {
			// Clean up subscriptions
			for (const cleanup of cleanupFunctions) {
				try {
					cleanup()
				} catch (error) {
					Logger.debug("[ClineAgent] Error during cleanup:", error)
				}
			}
			sessionState.status = AcpSessionStatus.Idle
		}
	}

	private async handleClineMessagesChanged(
		sessionId: string,
		sessionState: AcpSessionState,
		change: ClineMessageChange,
		resolvePrompt: (response: acp.PromptResponse) => void,
		promptResolved: { value: boolean },
	): Promise<void> {
		Logger.debug("[ClineAgent] handleClineMessagesChanged:", change)
		try {
			switch (change.type) {
				case "add":
					// Process the newly added message
					await this.processMessageWithDelta(sessionId, sessionState, change.message)
					this.checkMessageForPromptResolution(change.message, resolvePrompt, promptResolved)
					break

				case "update":
					// Process the updated message (streaming updates)
					await this.processMessageWithDelta(sessionId, sessionState, change.message)
					// Also check for prompt resolution on updates - message may have transitioned from partial to complete
					this.checkMessageForPromptResolution(change.message, resolvePrompt, promptResolved)
					break
				case "set":
					// The SET event fires when Cline replaces the full messages array (e.g.
					// removing a partial streaming message). The final message arrives via a
					// subsequent "add" event, hence no action needed.
					break
				case "delete":
					// Message deleted - no action needed for ACP updates
					break
			}
		} catch (error) {
			Logger.debug("[ClineAgent] Error handling clineMessagesChanged:", error)
		}
	}

	/**
	 * Handle a permission request for an ask message.
	 *
	 * This method:
	 * 1. Sends the permission request to the client
	 * 2. Waits for the user's decision
	 * 3. Responds to Cline's ask based on the decision
	 *
	 * @param sessionId - The session ID
	 * @param sessionState - The session state
	 * @param message - The Cline ask message
	 * @param permissionRequest - The permission request details from translateMessage
	 */
	private async handlePermissionRequest(
		sessionId: string,
		sessionState: AcpSessionState,
		message: ClineMessageType,
		permissionRequest: Omit<acp.RequestPermissionRequest, "sessionId">,
	): Promise<void> {
		const session = this.sessions.get(sessionId)

		if (!session) {
			Logger.debug("[ClineAgent] No session found for permission request")
			return
		}

		const controller = this.#sessionControllers.get(session)

		if (!controller?.task) {
			Logger.debug("[ClineAgent] No active task for permission request")
			return
		}

		const askType = message.ask as ClineAsk

		try {
			// Request permission from the client
			const response = await this.requestPermission(sessionId, permissionRequest.toolCall, permissionRequest.options)

			Logger.debug("[ClineAgent] Permission response received:", response.outcome)

			// Handle the response
			const result = handlePermissionResponse(response, askType)

			// Update tool call status based on permission result
			if (sessionState.currentToolCallId) {
				if (result.cancelled) {
					await this.emitSessionUpdate(sessionId, {
						sessionUpdate: "tool_call_update",
						toolCallId: sessionState.currentToolCallId,
						status: "failed",
						rawOutput: { reason: "cancelled" },
					})
				} else if (result.response === "noButtonClicked") {
					await this.emitSessionUpdate(sessionId, {
						sessionUpdate: "tool_call_update",
						toolCallId: sessionState.currentToolCallId,
						status: "failed",
						rawOutput: { reason: "rejected" },
					})
				} else {
					// Permission granted - mark as in_progress
					await this.emitSessionUpdate(sessionId, {
						sessionUpdate: "tool_call_update",
						toolCallId: sessionState.currentToolCallId,
						status: "in_progress",
					})
				}
			}

			// Respond to Cline's ask based on the permission result
			if (result.cancelled) {
				// Cancellation - reject the operation
				await controller.task.handleWebviewAskResponse("noButtonClicked")
			} else {
				// Pass the response to Cline
				await controller.task.handleWebviewAskResponse(result.response, result.text)
			}
		} catch (error) {
			Logger.debug("[ClineAgent] Error handling permission request:", error)

			// Update tool call status to failed
			if (sessionState.currentToolCallId) {
				await this.emitSessionUpdate(sessionId, {
					sessionUpdate: "tool_call_update",
					toolCallId: sessionState.currentToolCallId,
					status: "failed",
					rawOutput: { error: String(error) },
				})
			}

			// Reject the operation on error
			await controller.task.handleWebviewAskResponse("noButtonClicked")
		}
	}

	/**
	 * Check if a message should resolve the prompt (end the turn).
	 */
	private checkMessageForPromptResolution(
		message: ClineMessageType,
		resolvePrompt: (response: acp.PromptResponse) => void,
		promptResolved: { value: boolean },
	): void {
		if (promptResolved.value) return

		// Don't resolve for partial (still streaming) messages
		if (message.partial) return

		// Check for ask messages that require user input
		if (message.type === "ask") {
			const askType = message.ask as ClineAsk
			if (
				askType === "followup" ||
				askType === "plan_mode_respond" ||
				askType === "act_mode_respond" ||
				askType === "completion_result" ||
				askType === "resume_task" ||
				askType === "resume_completed_task"
			) {
				promptResolved.value = true
				resolvePrompt({ stopReason: "end_turn" })
				return
			}
		}

		// Check for completion_result say message
		if (message.type === "say" && message.say === "completion_result") {
			promptResolved.value = true
			resolvePrompt({ stopReason: "end_turn" })
		}
	}

	/**
	 * Process a message and compute deltas for streaming content.
	 *
	 * This method handles two categories of messages:
	 *
	 * 1. **Text-streaming messages** (say: text, reasoning, completion_result;
	 *    ask: followup, plan_mode_respond, completion_result):
	 *    - These stream incrementally via partial=true updates followed by partial=false
	 *    - We compute a delta (new chars only) to avoid re-sending already-sent content
	 *    - We own the full rendering for these message types; they must NOT fall through
	 *      to translateMessage (which would double-send the content)
	 *
	 * 2. **All other messages** (tool calls, commands, errors, etc.):
	 *    - Delegated entirely to translateMessage for proper ACP mapping
	 *    - No delta computation needed; each update is self-contained
	 *
	 * Note: act_mode_respond is intentionally excluded from text-streaming because its
	 * text content was already emitted via the preceding say: "text" message.
	 */
	private async processMessageWithDelta(
		sessionId: string,
		sessionState: AcpSessionState,
		message: ClineMessageType,
	): Promise<void> {
		const messageKey = message.ts

		// Determine if this is a text-streaming message type that we own entirely.
		// These message types stream text incrementally and must be handled with delta
		// computation here — they must NOT also go through translateMessage.
		const isTextStreamingMessage =
			(message.type === "say" &&
				(message.say === "text" || message.say === "reasoning" || message.say === "completion_result")) ||
			(message.type === "ask" &&
				(message.ask === "followup" || message.ask === "plan_mode_respond" || message.ask === "completion_result"))

		if (isTextStreamingMessage) {
			// Build a type key (e.g. "say:completion_result") for cross-timestamp dedup.
			// When Cline replaces a partial streaming message (ts=A) with a final non-partial
			// message (ts=B) via a SET event, ts=B won't be in partialMessageLastContent.
			// The type-keyed fallback lets us find the text already emitted for this message
			// type so we compute the correct delta and avoid re-sending the entire content.
			const typeKey = message.type === "say" ? `say:${message.say}` : `ask:${message.ask}`
			const lastText =
				this.partialMessageLastContent.get(messageKey) ?? this.partialMessageLastContentByType.get(typeKey) ?? ""

			// Even if message.text is empty/undefined, we still own this message type
			// and must not let it fall through to translateMessage (which would double-send).
			if (message.text) {
				// Extract the actual text content for JSON-wrapped messages.
				// plan_mode_respond uses { response: string, options?: string[] }
				// followup uses { question: string, options?: string[] }
				let textContent = message.text
				if (message.type === "ask" && (message.ask === "plan_mode_respond" || message.ask === "followup")) {
					try {
						const parsed = JSON.parse(message.text)
						if (message.ask === "plan_mode_respond" && parsed.response !== undefined) {
							textContent = parsed.response
						} else if (message.ask === "followup" && parsed.question !== undefined) {
							textContent = parsed.question
						}
					} catch {
						// If parsing fails, use the raw text
					}
				}

				// Compute delta to avoid re-sending already-streamed content
				let textDelta: string
				if (textContent.startsWith(lastText)) {
					textDelta = textContent.slice(lastText.length)
				} else {
					// Content changed entirely (rare edge case), send everything
					textDelta = textContent
				}

				if (textDelta) {
					const sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" =
						message.type === "say" && message.say === "reasoning" ? "agent_thought_chunk" : "agent_message_chunk"

					// For completion_result, prepend a newline on the very first chunk to
					// visually separate it from any preceding assistant text.
					const isCompletionResult =
						(message.type === "say" && message.say === "completion_result") ||
						(message.type === "ask" && message.ask === "completion_result")
					const needsLeadingNewline = isCompletionResult && lastText === ""

					await this.emitSessionUpdate(sessionId, {
						sessionUpdate,
						content: { type: "text", text: needsLeadingNewline ? `\n${textDelta}` : textDelta },
					})
				}

				// Track what we've sent so the next update can compute the correct delta.
				// Both maps are updated: the timestamp-keyed one for the normal streaming case,
				// and the type-keyed one as a fallback for when the final non-partial message
				// arrives with a different timestamp (after a SET event).
				this.partialMessageLastContent.set(messageKey, textContent)
				this.partialMessageLastContentByType.set(typeKey, textContent)
			}

			// Clean up the timestamp-keyed entry once the message is fully streamed.
			// The type-keyed entry is intentionally kept for the rest of the prompt cycle
			// so it can dedup any subsequent non-partial message with a new timestamp.
			if (!message.partial) {
				this.partialMessageLastContent.delete(messageKey)
				if (!message.text) {
					this.partialMessageLastContentByType.delete(typeKey)
				}
			}
		} else {
			// All other message types: delegate to translateMessage for proper ACP mapping.
			// Check if we already have a toolCallId for this message (from a previous partial
			// update) so we send a tool_call_update rather than a new tool_call.
			const existingToolCallId = this.messageToToolCallId.get(messageKey)

			const result = translateMessage(message, sessionState, {
				existingToolCallId,
			})

			// Emit all updates produced by the translator
			for (const update of result.updates) {
				await this.emitSessionUpdate(sessionId, update)
			}

			// Persist the toolCallId so subsequent partial updates reuse it
			if (result.toolCallId) {
				this.messageToToolCallId.set(messageKey, result.toolCallId)
			}

			// Handle permission requests for complete (non-partial) ask messages
			if (result.requiresPermission && result.permissionRequest && !message.partial) {
				await this.handlePermissionRequest(sessionId, sessionState, message, result.permissionRequest)
			}

			// Clean up the toolCallId mapping once the message is complete
			if (!message.partial && result.toolCallId) {
				this.messageToToolCallId.delete(messageKey)
			}
		}
	}

	/**
	 * Cancel the current operation in a session.
	 *
	 * This is a notification (no response expected). The agent should
	 * stop any ongoing processing for the specified session.
	 */
	async cancel(params: acp.CancelNotification): Promise<void> {
		const session = this.sessions.get(params.sessionId)
		if (!session) {
			Logger.debug("[ClineAgent] cancel called for non-existent session:", params.sessionId)
			return
		}
		const sessionState = this.sessionStates.get(params.sessionId)

		Logger.debug("[ClineAgent] cancel called:", {
			sessionId: params.sessionId,
			status: sessionState?.status,
		})

		if (sessionState) {
			sessionState.status = AcpSessionStatus.Cancelled

			// If we have an active controller task, cancel it
			const controller = this.#sessionControllers.get(session)
			if (controller?.task) {
				try {
					await controller.cancelTask()
				} catch (error) {
					Logger.debug("[ClineAgent] Error cancelling task:", error)
				}
			}
		}
	}

	/**
	 * Set the session mode (plan/act).
	 *
	 * Cline supports two modes:
	 * - "plan": Gather information and create a detailed plan
	 * - "act": Execute actions to accomplish the task
	 */
	async setSessionMode(params: acp.SetSessionModeRequest): Promise<acp.SetSessionModeResponse> {
		const session = this.sessions.get(params.sessionId)

		if (!session) {
			throw new Error(`Session not found: ${params.sessionId}`)
		}

		Logger.debug("[ClineAgent] setSessionMode called:", {
			sessionId: params.sessionId,
			modeId: params.modeId,
		})

		// Validate mode
		const validModes = ["plan", "act"]
		if (!validModes.includes(params.modeId)) {
			throw new Error(`Invalid mode: ${params.modeId}. Valid modes are: ${validModes.join(", ")}`)
		}

		// Update session mode
		session.mode = params.modeId as Mode
		session.lastActivityAt = Date.now()

		// Update Controller mode if active
		const controller = this.#sessionControllers.get(session)
		if (controller) {
			controller.stateManager.setGlobalState("mode", session.mode)

			// If there's an active task, switch its mode
			if (controller.task) {
				await controller.togglePlanActMode(session.mode)
			}
		}

		return {}
	}

	/**
	 * Handle authentication requests.
	 *
	 * This method implements OAuth flows for:
	 * - Cline account authentication (cline-oauth)
	 * - OpenAI Codex/ChatGPT authentication (openai-codex-oauth)
	 */
	async authenticate(params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse> {
		Logger.debug("[ClineAgent] authenticate called:", { methodId: params.methodId })

		// Handle OpenAI Codex OAuth flow
		if (params.methodId === "openai-codex-oauth") {
			return this.authenticateOpenAiCodex()
		}

		if (params.methodId !== "cline-oauth") {
			throw new Error(`Unknown authentication method: ${params.methodId}`)
		}

		// Enable the AuthHandler to receive OAuth callbacks
		const authHandler = AuthHandler.getInstance()
		authHandler.setEnabled(true)

		Logger.debug("[ClineAgent] AuthHandler enabled, getting callback URL...")

		// Get the callback URL first to ensure the server is ready
		let callbackUrl: string
		try {
			callbackUrl = await authHandler.getCallbackUrl("/auth")
			Logger.debug("[ClineAgent] Callback URL ready:", callbackUrl)
		} catch (error) {
			Logger.error("[ClineAgent] Failed to get callback URL:", error)
			throw new Error(`Failed to start auth server: ${error instanceof Error ? error.message : String(error)}`)
		}

		// Ensure WebviewProvider exists (creates one if not already created)
		// This is needed for SharedUriHandler to find the controller during OAuth callback
		if (!this.webviewProvider) {
			this.webviewProvider = HostProvider.get().createWebviewProvider()
		}

		try {
			// Get the AuthService instance with the webview's controller
			const authService = AuthService.getInstance(this.webviewProvider.controller)

			Logger.debug("[ClineAgent] Starting OAuth flow...")

			// Start the OAuth flow - this opens the browser
			await authService.createAuthRequest()

			Logger.debug("[ClineAgent] Browser opened, waiting for callback...")

			// Wait for authentication to complete (with timeout)
			const AUTH_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
			const POLL_INTERVAL_MS = 1000 // 1 second

			const startTime = Date.now()

			while (Date.now() - startTime < AUTH_TIMEOUT_MS) {
				const stateManager = StateManager.get()

				// Check if auth data has been stored
				const authData = stateManager.getSecretKey("cline:clineAccountId")
				if (authData) {
					Logger.debug("[ClineAgent] Authentication successful")

					// Set up the provider configuration for cline
					stateManager.setGlobalState("actModeApiProvider", "cline")
					stateManager.setGlobalState("planModeApiProvider", "cline")
					await stateManager.flushPendingState()

					return {}
				}

				// Wait before polling again
				await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
			}

			throw new Error("Authentication timed out. Please try again.")
		} catch (error) {
			Logger.error("[ClineAgent] Authentication error:", error)
			throw error
		}
	}

	// ============================================================
	// Helper Methods
	// ============================================================

	/**
	 * Emit a session update to the client.
	 *
	 * This method emits the update via the session's event emitter.
	 * Consumers (e.g. AcpAgent) subscribe to these events
	 */
	private async emitSessionUpdate(sessionId: string, update: acp.SessionUpdate): Promise<void> {
		const emitter = this.emitterForSession(sessionId)

		try {
			emitter.emit(update.sessionUpdate, update)
		} catch (error) {
			Logger.debug("[ClineAgent] Error emitting session update:", error)
			emitter.emit("error", error instanceof Error ? error : new Error(String(error)))
		}
	}

	/**
	 * Request permission from the client for a tool call.
	 *
	 * This method uses the permission handler callback to request permission.
	 * The handler is set by the AcpAgent wrapper or by programmatic users.
	 *
	 * @param sessionId - The session ID
	 * @param toolCall - The tool call update containing details about the operation
	 * @param options - Available permission options for the user to choose from
	 * @returns The permission response from the client
	 */
	protected async requestPermission(
		sessionId: string,
		toolCall: acp.ToolCallUpdate,
		options: acp.PermissionOption[],
	): Promise<acp.RequestPermissionResponse> {
		Logger.debug("[ClineAgent] Requesting permission:", {
			toolCallId: toolCall.toolCallId,
			options: options.map((o) => o.optionId),
		})

		if (!this.permissionHandler) {
			// No permission handler set - auto-reject for safety
			Logger.debug("[ClineAgent] No permission handler set, auto-rejecting")
			return { outcome: "rejected" as unknown as acp.RequestPermissionOutcome }
		}

		return await this.permissionHandler({ sessionId, toolCall, options })
	}

	async shutdown(): Promise<void> {
		for (const [sessionId, session] of this.sessions) {
			const controller = this.#sessionControllers.get(session)
			await controller?.task?.abortTask()
			await controller?.stateManager.flushPendingState()
			await controller?.dispose()
			this.sessions.delete(sessionId)
			this.sessionStates.delete(sessionId)
		}

		// Dispose the shared webview provider if it was created
		if (this.webviewProvider) {
			await this.webviewProvider.dispose()
			this.webviewProvider = undefined
		}
	}

	/**
	 * Get available slash commands and send them to the client.
	 *
	 * This fetches commands from Cline's slash command system, filters out
	 * CLI-only and VS Code-only commands, and converts them to ACP format.
	 */
	private async sendAvailableCommands(sessionId: string, controller: Controller): Promise<void> {
		try {
			// Get all available commands from Cline
			const response = await getAvailableSlashCommands(controller, {})

			// Filter out CLI-only and VS Code-only commands
			const cliOnlyNames = new Set(CLI_ONLY_COMMANDS.map((c) => c.name))
			const vscodeOnlyNames = new Set(VSCODE_ONLY_COMMANDS.map((c) => c.name))

			const filteredCommands = response.commands.filter(
				(cmd) => cmd.cliCompatible && !cliOnlyNames.has(cmd.name) && !vscodeOnlyNames.has(cmd.name),
			)

			// Convert to ACP AvailableCommand format
			const availableCommands: acp.AvailableCommand[] = filteredCommands.map((cmd) => ({
				name: cmd.name,
				description: cmd.description,
				input: {
					hint: cmd.description,
				},
			}))

			// Send the available_commands_update notification
			await this.emitSessionUpdate(sessionId, {
				sessionUpdate: "available_commands_update",
				availableCommands,
			})

			Logger.debug("[ClineAgent] Sent available commands:", {
				sessionId,
				commandCount: availableCommands.length,
				commands: availableCommands.map((c) => c.name),
			})
		} catch (error) {
			Logger.debug("[ClineAgent] Error sending available commands:", error)
		}
	}

	/**
	 * Handle OpenAI Codex OAuth authentication flow.
	 *
	 * This method:
	 * 1. Initializes the OAuth manager
	 * 2. Opens the browser to OpenAI's auth page
	 * 3. Waits for the callback with tokens
	 * 4. Configures the provider on success
	 */
	private async authenticateOpenAiCodex(): Promise<acp.AuthenticateResponse> {
		Logger.debug("[ClineAgent] Starting OpenAI Codex OAuth flow...")

		try {
			// Get the authorization URL and start the callback server
			const authUrl = openAiCodexOAuthManager.startAuthorizationFlow()

			Logger.debug("[ClineAgent] Opening browser for OpenAI Codex auth:", authUrl)

			// Open browser to authorization URL
			await openExternal(authUrl)

			// Wait for the callback (blocks until auth completes or times out)
			await openAiCodexOAuthManager.waitForCallback()

			Logger.debug("[ClineAgent] OpenAI Codex authentication successful")

			// Success - configure the provider
			const stateManager = StateManager.get()
			stateManager.setGlobalState("actModeApiProvider", "openai-codex")
			stateManager.setGlobalState("planModeApiProvider", "openai-codex")
			// Use provider-specific model ID keys for consistency
			const actModelKey = getProviderModelIdKey("openai-codex", "act")
			const planModelKey = getProviderModelIdKey("openai-codex", "plan")
			if (actModelKey) stateManager.setGlobalState(actModelKey, openAiCodexDefaultModelId)
			if (planModelKey) stateManager.setGlobalState(planModelKey, openAiCodexDefaultModelId)
			await stateManager.flushPendingState()

			return {}
		} catch (error) {
			// Clean up on error
			openAiCodexOAuthManager.cancelAuthorizationFlow()
			Logger.error("[ClineAgent] OpenAI Codex authentication error:", error)
			throw error
		}
	}
}

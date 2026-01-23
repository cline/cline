/**
 * ACP Agent implementation for Cline CLI.
 *
 * This class implements the ACP (Agent Client Protocol) Agent interface,
 * allowing Cline to be used as a subprocess agent by editors like Zed and JetBrains.
 *
 * @module acp
 */

import type * as acp from "@agentclientprotocol/sdk"
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import { registerPartialMessageCallback } from "@core/controller/ui/subscribeToPartialMessage"
import type { ClineAsk, ClineMessage as ClineMessageType } from "@shared/ExtensionMessage"
import { convertProtoToClineMessage } from "@shared/proto-conversions/cline-message"
import type { Controller } from "@/core/controller"
import type { StateManager } from "@/core/storage/StateManager"
import type { Mode } from "@/shared/storage/types"
import { AcpHostBridgeProvider } from "./AcpHostBridgeProvider.js"
import { AcpTerminalManager } from "./AcpTerminalManager.js"
import { translateMessage } from "./messageTranslator.js"
import {
	AutoApprovalTracker,
	getAutoApprovalIdentifier,
	processPermissionRequest,
	updateSessionStateAfterPermission,
} from "./permissionHandler.js"
import type { AcpAgentOptions, AcpSessionState, ClineAcpSession } from "./types.js"

/**
 * Cline's implementation of the ACP Agent interface.
 *
 * This agent bridges the ACP protocol with Cline's core Controller,
 * translating ACP requests into Controller operations and sending
 * session updates back to the client.
 */
export class AcpAgent implements acp.Agent {
	private readonly connection: acp.AgentSideConnection
	private readonly options: AcpAgentOptions

	/** Active sessions managed by this agent */
	private readonly sessions: Map<string, ClineAcpSession> = new Map()

	/** Runtime state for active sessions */
	private readonly sessionStates: Map<string, AcpSessionState> = new Map()

	/** Host bridge providers per session (for file operations delegation) */
	private readonly hostBridgeProviders: Map<string, AcpHostBridgeProvider> = new Map()

	/** Terminal managers per session (for terminal operations delegation) */
	private readonly terminalManagers: Map<string, AcpTerminalManager> = new Map()

	/** Controller instance - lazily initialized per session */
	private controller?: Controller

	/** State manager reference */
	private stateManager?: StateManager

	/** Client capabilities received during initialization */
	private clientCapabilities?: acp.ClientCapabilities

	/** Auto-approval tracker for remembering "always allow" decisions */
	private readonly autoApprovalTracker: AutoApprovalTracker = new AutoApprovalTracker()

	/** Track processed message timestamps to detect new messages */
	private processedMessageTimestamps: Set<number> = new Set()

	constructor(connection: acp.AgentSideConnection, options: AcpAgentOptions) {
		this.connection = connection
		this.options = options

		if (this.options.debug) {
			console.error("[AcpAgent] Initialized with options:", {
				version: options.version,
				globalStoragePath: options.globalStoragePath,
			})
		}
	}

	/**
	 * Initialize the agent and return its capabilities.
	 *
	 * This is the first method called by the client after establishing
	 * the connection. The agent returns its protocol version and capabilities.
	 */
	async initialize(params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
		this.clientCapabilities = params.clientCapabilities

		if (this.options.debug) {
			console.error("[AcpAgent] initialize called with:", {
				protocolVersion: params.protocolVersion,
				clientCapabilities: params.clientCapabilities,
			})
		}

		const agentCapabilities: acp.AgentCapabilities = {
			loadSession: true,
			promptCapabilities: {
				image: true,
				audio: false,
				embeddedContext: true,
			},
			mcpCapabilities: {
				http: true,
				sse: true,
			},
		}

		return {
			protocolVersion: PROTOCOL_VERSION,
			agentCapabilities,
			agentInfo: {
				name: "cline",
				version: this.options.version,
			},
		}
	}

	/**
	 * Create a new session.
	 *
	 * A session represents a conversation/task with the agent. The client
	 * provides the working directory and optionally MCP servers to use.
	 */
	async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
		const sessionId = crypto.randomUUID()

		if (this.options.debug) {
			console.error("[AcpAgent] newSession called:", {
				sessionId,
				cwd: params.cwd,
				mcpServers: params.mcpServers?.length ?? 0,
			})
		}

		// Create session record
		const session: ClineAcpSession = {
			sessionId,
			cwd: params.cwd,
			mode: "act", // Default to act mode
			mcpServers: params.mcpServers ?? [],
			createdAt: Date.now(),
			lastActivityAt: Date.now(),
		}

		this.sessions.set(sessionId, session)

		// Initialize session state
		const sessionState: AcpSessionState = {
			sessionId,
			isProcessing: false,
			cancelled: false,
			pendingToolCalls: new Map(),
		}

		this.sessionStates.set(sessionId, sessionState)

		// Create host bridge provider for file operations delegation
		const hostBridgeProvider = new AcpHostBridgeProvider(
			this.connection,
			this.clientCapabilities,
			sessionId,
			this.options.debug,
		)
		this.hostBridgeProviders.set(sessionId, hostBridgeProvider)

		// Create terminal manager for terminal operations delegation
		const terminalManager = new AcpTerminalManager(this.connection, this.clientCapabilities, sessionId, this.options.debug)
		this.terminalManagers.set(sessionId, terminalManager)

		if (this.options.debug) {
			console.error("[AcpAgent] Session providers created:", {
				sessionId,
				canReadFile: hostBridgeProvider.canReadFile(),
				canWriteFile: hostBridgeProvider.canWriteFile(),
				canUseTerminal: terminalManager.canUseTerminal(),
			})
		}

		// Initialize Controller if needed
		// Note: Full controller initialization will happen when processing the first prompt
		// to avoid blocking session creation

		return {
			sessionId,
			modes: {
				availableModes: [
					{ id: "plan", name: "Plan", description: "Gather information and create a detailed plan" },
					{ id: "act", name: "Act", description: "Execute actions to accomplish the task" },
				],
				currentModeId: session.mode,
			},
		}
	}

	/**
	 * Load an existing session from disk.
	 *
	 * This allows resuming a previous conversation. The agent will
	 * replay the conversation history via session updates.
	 */
	async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
		if (this.options.debug) {
			console.error("[AcpAgent] loadSession called:", {
				sessionId: params.sessionId,
				cwd: params.cwd,
			})
		}

		// Check if session exists in our active sessions
		let session = this.sessions.get(params.sessionId)

		if (!session) {
			// Try to load from task history
			const historyItem = await this.findTaskInHistory(params.sessionId)

			if (!historyItem) {
				throw new Error(`Session not found: ${params.sessionId}`)
			}

			// Recreate session from history
			session = {
				sessionId: params.sessionId,
				cwd: params.cwd,
				mode: "act", // Will be updated from task settings if available
				mcpServers: params.mcpServers ?? [],
				createdAt: historyItem.ts,
				lastActivityAt: Date.now(),
			}

			this.sessions.set(params.sessionId, session)

			// Initialize session state
			const sessionState: AcpSessionState = {
				sessionId: params.sessionId,
				isProcessing: false,
				cancelled: false,
				pendingToolCalls: new Map(),
			}

			this.sessionStates.set(params.sessionId, sessionState)

			// Create host bridge provider for file operations delegation
			const hostBridgeProvider = new AcpHostBridgeProvider(
				this.connection,
				this.clientCapabilities,
				params.sessionId,
				this.options.debug,
			)
			this.hostBridgeProviders.set(params.sessionId, hostBridgeProvider)

			// Create terminal manager for terminal operations delegation
			const terminalManager = new AcpTerminalManager(
				this.connection,
				this.clientCapabilities,
				params.sessionId,
				this.options.debug,
			)
			this.terminalManagers.set(params.sessionId, terminalManager)

			if (this.options.debug) {
				console.error("[AcpAgent] Session providers created for loaded session:", {
					sessionId: params.sessionId,
					canReadFile: hostBridgeProvider.canReadFile(),
					canWriteFile: hostBridgeProvider.canWriteFile(),
					canUseTerminal: terminalManager.canUseTerminal(),
				})
			}

			// TODO: Replay conversation history via session updates
			// This will be implemented in Phase 8 (Session Persistence)
		}

		return {
			modes: {
				availableModes: [
					{ id: "plan", name: "Plan", description: "Gather information and create a detailed plan" },
					{ id: "act", name: "Act", description: "Execute actions to accomplish the task" },
				],
				currentModeId: session.mode,
			},
		}
	}

	/**
	 * Handle a user prompt.
	 *
	 * This is the main entry point for user interaction. The agent
	 * processes the prompt and sends updates back via sessionUpdate.
	 *
	 * The prompt flow:
	 * 1. Extract content from the ACP prompt (text, images, files)
	 * 2. Set up state broadcasting (subscribe to controller updates)
	 * 3. Initialize or continue task with Controller
	 * 4. Translate ClineMessages to ACP SessionUpdates
	 * 5. Handle permission requests for tools/commands
	 * 6. Return when task completes, is cancelled, or needs user input
	 */
	async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
		const session = this.sessions.get(params.sessionId)
		const sessionState = this.sessionStates.get(params.sessionId)

		if (!session || !sessionState) {
			throw new Error(`Session not found: ${params.sessionId}`)
		}

		if (sessionState.isProcessing) {
			throw new Error(`Session ${params.sessionId} is already processing a prompt`)
		}

		if (!this.controller) {
			throw new Error("Controller not initialized. This is a bug in the ACP agent setup.")
		}

		if (this.options.debug) {
			console.error("[AcpAgent] prompt called:", {
				sessionId: params.sessionId,
				promptLength: params.prompt.length,
			})
		}

		// Mark session as processing
		sessionState.isProcessing = true
		sessionState.cancelled = false
		session.lastActivityAt = Date.now()

		// Clear processed timestamps for new prompt cycle
		this.processedMessageTimestamps.clear()

		// Track cleanup functions for subscriptions
		const cleanupFunctions: (() => void)[] = []

		// Promise that resolves when task completes, is cancelled, or needs input
		let resolvePrompt: (response: acp.PromptResponse) => void
		let rejectPrompt: (error: Error) => void
		const promptPromise = new Promise<acp.PromptResponse>((resolve, reject) => {
			resolvePrompt = resolve
			rejectPrompt = reject
		})

		// Track if we've already resolved/rejected
		let promptResolved = false

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

			if (this.options.debug) {
				console.error("[AcpAgent] Processing prompt:", {
					textLength: textContent.length,
					imageCount: imageContent.length,
					fileCount: fileResources.length,
				})
			}

			// Set up state broadcasting - subscribe to controller state updates
			const originalPostState = this.controller.postStateToWebview.bind(this.controller)
			this.controller.postStateToWebview = async () => {
				await originalPostState()
				await this.handleStateUpdate(params.sessionId, sessionState)
			}
			cleanupFunctions.push(() => {
				if (this.controller) {
					this.controller.postStateToWebview = originalPostState
				}
			})

			// Subscribe to partial message events for streaming updates
			const unsubscribePartial = registerPartialMessageCallback((protoMessage) => {
				const message = convertProtoToClineMessage(protoMessage) as ClineMessageType
				this.handlePartialMessage(params.sessionId, sessionState, message).catch((error) => {
					if (this.options.debug) {
						console.error("[AcpAgent] Error handling partial message:", error)
					}
				})
			})
			cleanupFunctions.push(unsubscribePartial)

			// Determine if this is a new task or continuation
			const hasActiveTask = this.controller.task !== undefined

			if (hasActiveTask && this.controller.task) {
				// Continue existing task - respond to pending ask
				if (this.options.debug) {
					console.error("[AcpAgent] Continuing existing task:", this.controller.task.taskId)
				}

				// Find the last ask message and respond to it
				const messages = this.controller.task.messageStateHandler.getClineMessages()
				const lastAskMessage = [...messages].reverse().find((m) => m.type === "ask")

				if (lastAskMessage) {
					await this.controller.task.handleWebviewAskResponse(
						"messageResponse",
						textContent,
						imageContent,
						fileResources,
					)
				} else {
					// No pending ask - treat as new user message
					// This shouldn't normally happen but handle gracefully
					if (this.options.debug) {
						console.error("[AcpAgent] No pending ask found, starting new task")
					}
					await this.controller.initTask(textContent, imageContent, fileResources)
				}
			} else {
				// Start new task
				if (this.options.debug) {
					console.error("[AcpAgent] Starting new task")
				}
				await this.controller.initTask(textContent, imageContent, fileResources)
			}

			// Wait for task to complete, be cancelled, or need user input
			const checkTaskState = async () => {
				if (promptResolved) return

				// Check cancellation
				if (sessionState.cancelled) {
					promptResolved = true
					resolvePrompt({ stopReason: "cancelled" })
					return
				}

				// Check if controller has a task
				if (!this.controller?.task) {
					// Task was cleared - likely completed or cancelled
					promptResolved = true
					resolvePrompt({ stopReason: "end_turn" })
					return
				}

				const task = this.controller.task
				const taskState = task.taskState

				// Check if task is awaiting user response (followup, plan response, etc.)
				if (taskState.isAwaitingPlanResponse || taskState.isAwaitingUserResponse) {
					promptResolved = true
					resolvePrompt({ stopReason: "end_turn" })
					return
				}

				// Check if streaming has finished and there's no pending ask
				if (!taskState.isStreaming) {
					const messages = task.messageStateHandler.getClineMessages()
					const lastMessage = messages[messages.length - 1]

					// If last message is an ask that requires user input, we're done
					if (lastMessage?.type === "ask") {
						const askType = lastMessage.ask as ClineAsk
						// followup, plan_mode_respond, act_mode_respond all require next prompt
						if (
							askType === "followup" ||
							askType === "plan_mode_respond" ||
							askType === "act_mode_respond" ||
							askType === "completion_result" ||
							askType === "resume_task" ||
							askType === "resume_completed_task"
						) {
							promptResolved = true
							resolvePrompt({ stopReason: "end_turn" })
							return
						}
					}

					// If last message is completion_result say, we're done
					if (lastMessage?.type === "say" && lastMessage.say === "completion_result") {
						promptResolved = true
						resolvePrompt({ stopReason: "end_turn" })
						return
					}
				}

				// Continue polling
				if (!promptResolved) {
					setTimeout(checkTaskState, 100)
				}
			}

			// Start checking task state
			checkTaskState()

			// Return the promise that will resolve when task completes
			return await promptPromise
		} catch (error) {
			if (!promptResolved) {
				promptResolved = true
				// Send error as session update before returning
				await this.sendSessionUpdate(params.sessionId, {
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
					if (this.options.debug) {
						console.error("[AcpAgent] Error during cleanup:", error)
					}
				}
			}
			sessionState.isProcessing = false
		}
	}

	/**
	 * Handle a state update from the controller.
	 * This is called whenever Controller.postStateToWebview() is invoked.
	 */
	private async handleStateUpdate(sessionId: string, sessionState: AcpSessionState): Promise<void> {
		if (!this.controller) return

		try {
			const state = await this.controller.getStateToPostToWebview()
			const messages = state.clineMessages || []

			// Process new or updated messages
			for (const message of messages) {
				await this.processMessage(sessionId, sessionState, message, false)
			}
		} catch (error) {
			if (this.options.debug) {
				console.error("[AcpAgent] Error handling state update:", error)
			}
		}
	}

	/**
	 * Handle a partial message update (streaming content).
	 */
	private async handlePartialMessage(
		sessionId: string,
		sessionState: AcpSessionState,
		message: ClineMessageType,
	): Promise<void> {
		await this.processMessage(sessionId, sessionState, message, true)
	}

	/**
	 * Process a single ClineMessage and send appropriate ACP updates.
	 */
	private async processMessage(
		sessionId: string,
		sessionState: AcpSessionState,
		message: ClineMessageType,
		isPartial: boolean,
	): Promise<void> {
		const messageKey = message.ts

		// For partial messages, always process (they're updates to existing)
		// For complete messages, check if already processed
		if (!isPartial && this.processedMessageTimestamps.has(messageKey)) {
			return
		}

		// Mark as processed if complete
		if (!isPartial) {
			this.processedMessageTimestamps.add(messageKey)
		}

		// Translate the message to ACP updates
		const translated = translateMessage(message, sessionState)

		// Send all generated updates
		for (const update of translated.updates) {
			await this.sendSessionUpdate(sessionId, update)
		}

		// Handle permission requests
		if (translated.requiresPermission && translated.permissionRequest) {
			await this.handlePermissionRequest(sessionId, sessionState, message, translated.permissionRequest)
		}
	}

	/**
	 * Handle a permission request from a tool/command.
	 */
	private async handlePermissionRequest(
		sessionId: string,
		sessionState: AcpSessionState,
		message: ClineMessageType,
		permissionRequest: { toolCall: acp.ToolCall; options: acp.PermissionOption[] },
	): Promise<void> {
		if (!this.controller?.task) return

		const askType = message.ask as ClineAsk
		const identifier = getAutoApprovalIdentifier(permissionRequest.toolCall, askType)

		try {
			const result = await processPermissionRequest(
				(sid, tc, opts) => this.requestPermission(sid, tc, opts),
				sessionId,
				permissionRequest.toolCall,
				askType,
				identifier,
				this.autoApprovalTracker,
			)

			// Update session state
			updateSessionStateAfterPermission(
				sessionState,
				permissionRequest.toolCall.toolCallId,
				result.response === "yesButtonClicked",
			)

			// Send tool call update based on permission result
			const status: acp.ToolCallStatus = result.response === "yesButtonClicked" ? "in_progress" : "cancelled"
			await this.sendSessionUpdate(sessionId, {
				sessionUpdate: "tool_call_update",
				toolCallId: permissionRequest.toolCall.toolCallId,
				status,
			})

			// Respond to the task's ask
			if (result.cancelled) {
				// User cancelled - don't respond, let task handle timeout
				return
			}

			await this.controller.task.handleWebviewAskResponse(result.response, result.text)
		} catch (error) {
			if (this.options.debug) {
				console.error("[AcpAgent] Error handling permission request:", error)
			}

			// On error, mark tool as failed
			await this.sendSessionUpdate(sessionId, {
				sessionUpdate: "tool_call_update",
				toolCallId: permissionRequest.toolCall.toolCallId,
				status: "failed",
				rawOutput: { error: error instanceof Error ? error.message : String(error) },
			})
		}
	}

	/**
	 * Cancel the current operation in a session.
	 *
	 * This is a notification (no response expected). The agent should
	 * stop any ongoing processing for the specified session.
	 */
	async cancel(params: acp.CancelNotification): Promise<void> {
		const sessionState = this.sessionStates.get(params.sessionId)

		if (this.options.debug) {
			console.error("[AcpAgent] cancel called:", {
				sessionId: params.sessionId,
				isProcessing: sessionState?.isProcessing,
			})
		}

		if (sessionState) {
			sessionState.cancelled = true

			// If we have an active controller task, cancel it
			if (this.controller?.task) {
				try {
					await this.controller.cancelTask()
				} catch (error) {
					if (this.options.debug) {
						console.error("[AcpAgent] Error cancelling task:", error)
					}
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

		if (this.options.debug) {
			console.error("[AcpAgent] setSessionMode called:", {
				sessionId: params.sessionId,
				modeId: params.modeId,
			})
		}

		// Validate mode
		const validModes = ["plan", "act"]
		if (!validModes.includes(params.modeId)) {
			throw new Error(`Invalid mode: ${params.modeId}. Valid modes are: ${validModes.join(", ")}`)
		}

		// Update session mode
		session.mode = params.modeId as Mode
		session.lastActivityAt = Date.now()

		// Update Controller mode if active
		if (this.controller && this.stateManager) {
			this.stateManager.setGlobalState("mode", session.mode)

			// If there's an active task, switch its mode
			if (this.controller.task) {
				await this.controller.togglePlanActMode(session.mode)
			}
		}

		return {}
	}

	/**
	 * Handle authentication requests.
	 *
	 * Currently a no-op as Cline handles authentication separately.
	 * Future versions may support OAuth flows through this method.
	 */
	async authenticate(_params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse> {
		if (this.options.debug) {
			console.error("[AcpAgent] authenticate called (no-op)")
		}

		// Authentication is handled externally for Cline
		// Return empty response to indicate no auth action needed
		return {}
	}

	// ============================================================
	// Helper Methods
	// ============================================================

	/**
	 * Send a session update to the client.
	 */
	private async sendSessionUpdate(sessionId: string, update: acp.SessionUpdate): Promise<void> {
		try {
			await this.connection.sessionUpdate({
				sessionId,
				update,
			})
		} catch (error) {
			if (this.options.debug) {
				console.error("[AcpAgent] Error sending session update:", error)
			}
		}
	}

	/**
	 * Request permission from the client for a tool operation.
	 */
	async requestPermission(
		sessionId: string,
		toolCall: acp.ToolCall,
		options: acp.PermissionOption[],
	): Promise<acp.RequestPermissionResponse> {
		return this.connection.requestPermission({
			sessionId,
			toolCall,
			options,
		})
	}

	/**
	 * Find a task in the task history by ID.
	 */
	private async findTaskInHistory(taskId: string): Promise<{ id: string; ts: number; task: string } | undefined> {
		if (!this.stateManager) {
			return undefined
		}

		const taskHistory = this.stateManager.getGlobalStateKey("taskHistory") ?? []
		return taskHistory.find((item: { id: string }) => item.id === taskId)
	}

	/**
	 * Set the Controller instance for this agent.
	 * Called by runAcpMode after initializing the CLI infrastructure.
	 */
	setController(controller: Controller): void {
		this.controller = controller
		this.stateManager = controller.stateManager
	}

	/**
	 * Get the current session by ID.
	 */
	getSession(sessionId: string): ClineAcpSession | undefined {
		return this.sessions.get(sessionId)
	}

	/**
	 * Get the session state by ID.
	 */
	getSessionState(sessionId: string): AcpSessionState | undefined {
		return this.sessionStates.get(sessionId)
	}

	/**
	 * Check if a session exists.
	 */
	hasSession(sessionId: string): boolean {
		return this.sessions.has(sessionId)
	}

	/**
	 * Get the connection instance.
	 */
	getConnection(): acp.AgentSideConnection {
		return this.connection
	}

	/**
	 * Get client capabilities.
	 */
	getClientCapabilities(): acp.ClientCapabilities | undefined {
		return this.clientCapabilities
	}

	/**
	 * Get the host bridge provider for a session.
	 * Used for delegating file operations to the ACP client.
	 */
	getHostBridgeProvider(sessionId: string): AcpHostBridgeProvider | undefined {
		return this.hostBridgeProviders.get(sessionId)
	}

	/**
	 * Get the terminal manager for a session.
	 * Used for delegating terminal operations to the ACP client.
	 */
	getTerminalManager(sessionId: string): AcpTerminalManager | undefined {
		return this.terminalManagers.get(sessionId)
	}
}

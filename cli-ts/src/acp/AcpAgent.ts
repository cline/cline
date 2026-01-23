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
import type { Controller } from "@/core/controller"
import type { StateManager } from "@/core/storage/StateManager"
import type { Mode } from "@/shared/storage/types"
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

	/** Controller instance - lazily initialized per session */
	private controller?: Controller

	/** State manager reference */
	private stateManager?: StateManager

	/** Client capabilities received during initialization */
	private clientCapabilities?: acp.ClientCapabilities

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

		try {
			// Extract text content from prompt
			const textContent = params.prompt
				.filter((block): block is acp.TextContent & { type: "text" } => block.type === "text")
				.map((block) => block.text)
				.join("\n")

			// Extract image content
			const imageContent = params.prompt
				.filter((block): block is acp.ImageContent & { type: "image" } => block.type === "image")
				.map((block) => block.data)

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

			// Send initial acknowledgment
			await this.sendSessionUpdate(params.sessionId, {
				sessionUpdate: "agent_message_chunk",
				content: {
					type: "text",
					text: "",
				},
			})

			// TODO: Initialize Controller and process the prompt
			// This will be fully implemented when integrating with Controller
			// For now, return a placeholder response

			// Check if cancelled during processing
			if (sessionState.cancelled) {
				return { stopReason: "cancelled" }
			}

			return { stopReason: "end_turn" }
		} finally {
			sessionState.isProcessing = false
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
}

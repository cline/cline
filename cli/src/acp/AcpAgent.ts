/**
 * AcpAgent - Thin wrapper that bridges stdio connection to ClineAgent.
 *
 * This class wraps the ClineAgent and connects it to an ACP AgentSideConnection
 * for stdio-based communication. It:
 * - Wires up the permission handler to call connection.requestPermission()
 * - Subscribes to ClineAgent session events and forwards them to connection.sessionUpdate()
 * - Delegates all acp.Agent methods to the internal ClineAgent
 *
 * For programmatic usage without stdio, use ClineAgent directly.
 *
 * @module acp
 */

import type * as acp from "@agentclientprotocol/sdk"
import { Logger } from "@/shared/services/Logger.js"
import { ClineAgent } from "../agent/ClineAgent.js"
import type { AcpAgentOptions, SessionUpdateType } from "../agent/types.js"

/**
 * ACP Agent wrapper that bridges stdio connection to ClineAgent.
 *
 * This is the class used by runAcpMode() for stdio-based ACP communication.
 * It creates an internal ClineAgent and wires up the connection for:
 * - Permission requests (via connection.requestPermission)
 * - Session updates (via connection.sessionUpdate)
 */
export class AcpAgent implements acp.Agent {
	private readonly connection: acp.AgentSideConnection
	private readonly clineAgent: ClineAgent

	/** Track which sessions we've subscribed to for event forwarding */
	private readonly subscribedSessions: Set<string> = new Set()

	constructor(connection: acp.AgentSideConnection, options: AcpAgentOptions) {
		this.connection = connection

		// Create the internal ClineAgent
		this.clineAgent = new ClineAgent(options)

		// Wire up the permission handler to use the connection
		this.clineAgent.setPermissionHandler(async (request, resolve) => {
			try {
				Logger.debug("[AcpAgent] Forwarding permission request to connection")
				const response = await this.connection.requestPermission({
					sessionId: this.getCurrentSessionId() ?? "",
					toolCall: request.toolCall,
					options: request.options,
				})
				resolve(response)
			} catch (error) {
				Logger.debug("[AcpAgent] Error requesting permission:", error)
				resolve({ outcome: "rejected" as unknown as acp.RequestPermissionOutcome })
			}
		})
	}

	/**
	 * Get the current active session ID from the ClineAgent.
	 */
	private getCurrentSessionId(): string | undefined {
		// Find the session that's currently processing
		for (const [sessionId, session] of this.clineAgent.sessions) {
			if (session.controller?.task) {
				return sessionId
			}
		}
		// Fall back to the first session if none is actively processing
		const firstSession = this.clineAgent.sessions.keys().next()
		return firstSession.done ? undefined : firstSession.value
	}

	/**
	 * Subscribe to session events and forward them to the connection.
	 */
	private subscribeToSessionEvents(sessionId: string): void {
		if (this.subscribedSessions.has(sessionId)) {
			return
		}

		const emitter = this.clineAgent.emitterForSession(sessionId)

		// Forward session update by adding the sessionUpdate discriminator
		const forwardSessionUpdate = <K extends SessionUpdateType>(eventName: K) => {
			emitter.on(eventName, (payload: Record<string, unknown>) => {
				const update = {
					sessionUpdate: eventName,
					...payload,
				} as acp.SessionUpdate
				this.connection.sessionUpdate({ sessionId, update }).catch((error) => {
					Logger.error(`[AcpAgent] Error forwarding ${eventName}:`, error)
				})
			})
		}

		// Forward all standard session updates
		forwardSessionUpdate("agent_message_chunk")
		forwardSessionUpdate("agent_thought_chunk")
		forwardSessionUpdate("tool_call")
		forwardSessionUpdate("tool_call_update")
		forwardSessionUpdate("available_commands_update")
		forwardSessionUpdate("plan")
		forwardSessionUpdate("current_mode_update")
		forwardSessionUpdate("user_message_chunk")
		forwardSessionUpdate("config_option_update")
		forwardSessionUpdate("session_info_update")

		// Handle errors specially (not part of ACP SessionUpdate)
		emitter.on("error", (error) => {
			Logger.error("[AcpAgent] Session error:", error)
		})

		this.subscribedSessions.add(sessionId)
	}

	// ============================================================
	// acp.Agent Interface Implementation - Delegate to ClineAgent
	// ============================================================

	async initialize(params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
		return await this.clineAgent.initialize(params, this.connection)
	}

	async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
		const response = await this.clineAgent.newSession(params)
		// Subscribe to events for this new session
		this.subscribeToSessionEvents(response.sessionId)
		return response
	}

	async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
		// Ensure we're subscribed to this session's events
		this.subscribeToSessionEvents(params.sessionId)
		return this.clineAgent.prompt(params)
	}

	async cancel(params: acp.CancelNotification): Promise<void> {
		return this.clineAgent.cancel(params)
	}

	async setSessionMode(params: acp.SetSessionModeRequest): Promise<acp.SetSessionModeResponse> {
		return this.clineAgent.setSessionMode(params)
	}

	async unstable_setSessionModel(params: acp.SetSessionModelRequest): Promise<acp.SetSessionModelResponse> {
		return this.clineAgent.unstable_setSessionModel(params)
	}

	async authenticate(params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse> {
		return this.clineAgent.authenticate(params)
	}

	async shutdown(): Promise<void> {
		this.subscribedSessions.clear()
		return this.clineAgent.shutdown()
	}
}

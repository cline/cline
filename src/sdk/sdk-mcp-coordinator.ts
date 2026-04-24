import type { SessionHost } from "@clinebot/core"
import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { VscodeSessionHost } from "./vscode-session-host"

type StartInput = Parameters<VscodeSessionHost["start"]>[0]
type InitialMessages = StartInput["initialMessages"]
type SessionConfig = Awaited<ReturnType<SdkSessionConfigBuilder["build"]>>

export interface SdkMcpCoordinatorOptions {
	stateManager: StateManager
	sessions: SdkSessionLifecycle
	messages: SdkMessageCoordinator
	sessionConfigBuilder: SdkSessionConfigBuilder
	getWorkspaceRoot: () => Promise<string>
	loadInitialMessages: (sessionManager: SessionHost, sessionId: string) => Promise<unknown[] | undefined>
	buildStartSessionInput: (config: SessionConfig, input: { cwd: string; mode: Mode }) => StartInput
	postStateToWebview: () => Promise<void>
}

export class SdkMcpCoordinator {
	private restartPending = false

	constructor(private readonly options: SdkMcpCoordinatorOptions) {}

	handleToolListChanged(): void {
		Logger.log("[SdkController] MCP tool list changed")

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			Logger.log("[SdkController] No active session - tools will be picked up on next initTask")
			return
		}

		if (activeSession.isRunning) {
			Logger.log("[SdkController] Session is mid-turn - deferring MCP tool restart")
			this.restartPending = true
			return
		}

		this.restartSessionForMcpTools().catch((error) => {
			Logger.error("[SdkController] Failed to restart session for MCP tools:", error)
		})
	}

	checkDeferredRestart(): void {
		if (!this.restartPending) {
			return
		}
		this.restartPending = false

		if (!this.options.sessions.getActiveSession()) {
			Logger.log("[SdkController] Deferred MCP restart: no active session, skipping")
			return
		}

		Logger.log("[SdkController] Executing deferred MCP tool restart")
		this.restartSessionForMcpTools().catch((error) => {
			Logger.error("[SdkController] Failed deferred MCP tool restart:", error)
		})
	}

	async restartSessionForMcpTools(): Promise<void> {
		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			return
		}

		const { sessionManager: oldManager, sessionId: oldSessionId } = activeSession

		Logger.log(`[SdkController] Restarting session ${oldSessionId} for MCP tool changes`)

		const infoMessage: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "info",
			text: "MCP tools changed - reloading tools for this session...",
			partial: false,
		}
		this.options.messages.appendAndEmit([infoMessage], {
			type: "status",
			payload: { sessionId: oldSessionId, status: "running" },
		})

		try {
			const cwd = await this.options.getWorkspaceRoot()
			const modeValue = this.options.stateManager.getGlobalSettingsKey("mode")
			const mode: Mode = modeValue === "plan" || modeValue === "act" ? modeValue : "act"
			const config = await this.options.sessionConfigBuilder.build({ cwd, mode })
			config.sessionId = oldSessionId

			const initialMessages = await this.options.loadInitialMessages(oldManager, oldSessionId)
			const startInput = this.options.buildStartSessionInput(config, { cwd, mode })
			const restartResult = await this.options.sessions.replaceActiveSession({
				startInput,
				initialMessages: initialMessages as InitialMessages,
				disposeReason: "mcpToolRestart",
			})
			if (!restartResult) {
				return
			}
			const { startResult } = restartResult

			if (startResult.sessionId !== oldSessionId) {
				Logger.warn(
					`[SdkController] MCP tool restart returned a new session ID (${startResult.sessionId}); preserving task ID ${oldSessionId} for UI continuity`,
				)
			}

			const successMessage: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "info",
				text: "MCP tools reloaded successfully. You can continue your conversation.",
				partial: false,
			}
			const completionAsk: ClineMessage = {
				ts: successMessage.ts + 1,
				type: "ask",
				ask: "completion_result",
				text: "",
				partial: false,
			}
			this.options.messages.appendAndEmit([successMessage, completionAsk], {
				type: "status",
				payload: { sessionId: startResult.sessionId, status: "idle" },
			})

			await this.options.postStateToWebview()
			Logger.log(`[SdkController] Session restarted for MCP tools: ${oldSessionId} -> ${startResult.sessionId}`)
		} catch (error) {
			Logger.error("[SdkController] Failed to restart session for MCP tools:", error)

			const errorMessage: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "error",
				text: `Failed to reload MCP tools: ${error instanceof Error ? error.message : String(error)}. MCP tools may be outdated.`,
				partial: false,
			}
			this.options.messages.appendAndEmit([errorMessage], {
				type: "status",
				payload: { sessionId: oldSessionId, status: "error" },
			})
			await this.options.postStateToWebview()
		}
	}
}

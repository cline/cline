import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkSessionRebuildScheduler } from "./sdk-session-rebuild-scheduler"
import type { SdkSessionHost } from "./session-host"
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
	loadInitialMessages: (sdkHost: SdkSessionHost, sessionId: string) => Promise<unknown[] | undefined>
	buildStartSessionInput: (config: SessionConfig, input: { cwd: string; mode: Mode }) => StartInput
	postStateToWebview: () => Promise<void>
	rebuilds: Pick<SdkSessionRebuildScheduler, "request">
}

export class SdkMcpCoordinator {
	constructor(private readonly options: SdkMcpCoordinatorOptions) {}

	handleToolListChanged(): void {
		Logger.log("[SdkController] MCP tool list changed")

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			Logger.log("[SdkController] No active session - tools will be picked up on next initTask")
			return
		}

		this.options.rebuilds.request("mcpTools", () => this.restartSessionForMcpTools())
	}

	async restartSessionForMcpTools(): Promise<void> {
		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			return
		}

		const { sdkHost: oldManager, sessionId: oldSessionId } = activeSession

		Logger.log(`[SdkController] Restarting session ${oldSessionId} for MCP tool changes`)

		// Reloading tools is a silent, behind-the-scenes operation — it should
		// "just work" without spamming the chat. Emit only the status transition
		// (no chat message), so toggling several servers doesn't pile up notices.
		this.options.messages.emitSessionEvents([], {
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
				expectedSession: activeSession,
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

			// Silently return the session to idle — no "reloaded successfully"
			// chat message or completion banner. The reload is transparent.
			this.options.messages.emitSessionEvents([], {
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

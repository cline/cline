import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkSessionHost } from "./session-host"
import { getEffectiveTerminalExecutionMode, type VscodeTerminalExecutionMode } from "./vscode-terminal-execution-mode"
import type { VscodeSessionHost } from "./vscode-session-host"

type StartInput = Parameters<VscodeSessionHost["start"]>[0]
type InitialMessages = StartInput["initialMessages"]
type SessionConfig = Awaited<ReturnType<SdkSessionConfigBuilder["build"]>>

export interface SdkTerminalExecutionModeCoordinatorOptions {
	stateManager: StateManager
	sessions: SdkSessionLifecycle
	messages: SdkMessageCoordinator
	sessionConfigBuilder: SdkSessionConfigBuilder
	getWorkspaceRoot: () => Promise<string>
	loadInitialMessages: (sdkHost: SdkSessionHost, sessionId: string) => Promise<unknown[] | undefined>
	buildStartSessionInput: (config: SessionConfig, input: { cwd: string; mode: Mode }) => StartInput
	postStateToWebview: () => Promise<void>
}

export class SdkTerminalExecutionModeCoordinator {
	private restartPending = false
	// Serializes concurrent restart calls the same way SdkProviderChangeCoordinator
	// does — without this, two rapid mode changes could race replaceActiveSession
	// against itself and leave the session in an inconsistent state.
	private restartInFlight: Promise<void> | undefined

	constructor(private readonly options: SdkTerminalExecutionModeCoordinatorOptions) {}

	handleTerminalExecutionModeChanged(previous: VscodeTerminalExecutionMode, next: VscodeTerminalExecutionMode): void {
		if (previous === next) {
			return
		}

		Logger.log(`[SdkController] Terminal execution mode changed: ${previous} -> ${next}`)

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			Logger.log("[SdkController] No active session - terminal mode tools will be picked up on next initTask")
			return
		}

		if (activeSession.isRunning) {
			Logger.log("[SdkController] Session is mid-turn - deferring terminal mode tool restart")
			this.restartPending = true
			return
		}

		this.restartSessionForTerminalExecutionMode().catch((error) => {
			Logger.error("[SdkController] Failed to restart session for terminal execution mode:", error)
		})
	}

	checkDeferredRestart(): void {
		if (!this.restartPending) {
			return
		}
		this.restartPending = false

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			Logger.log("[SdkController] Deferred terminal mode restart: no active session, skipping")
			return
		}

		// The turn that was running when the mode change was requested may still
		// be running (or a new turn may have started) by the time this check
		// runs — re-defer rather than restarting mid-turn.
		if (activeSession.isRunning) {
			Logger.log("[SdkController] Deferred terminal mode restart: session is still running")
			this.restartPending = true
			return
		}

		Logger.log("[SdkController] Executing deferred terminal mode tool restart")
		this.restartSessionForTerminalExecutionMode().catch((error) => {
			Logger.error("[SdkController] Failed deferred terminal mode restart:", error)
		})
	}

	async restartSessionForTerminalExecutionMode(): Promise<void> {
		if (this.restartInFlight) {
			this.restartPending = true
			return this.restartInFlight
		}

		const operation = this.performRestartSessionForTerminalExecutionMode()
		this.restartInFlight = operation.then(
			() => undefined,
			// restartInFlight is only a serialization gate. The caller awaits
			// operation below, where restart failures are reported to the user.
			() => undefined,
		)

		try {
			await operation
		} finally {
			this.restartInFlight = undefined
			this.checkDeferredRestart()
		}
	}

	private async performRestartSessionForTerminalExecutionMode(): Promise<void> {
		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			return
		}

		const { sdkHost: oldManager, sessionId: oldSessionId } = activeSession
		const requestedTerminalMode = this.options.stateManager.getGlobalStateKey("vscodeTerminalExecutionMode")
		const terminalMode = getEffectiveTerminalExecutionMode(requestedTerminalMode)

		Logger.log(`[SdkController] Restarting session ${oldSessionId} for terminal execution mode ${terminalMode}`)

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

			// Re-check that the active session hasn't been replaced by another path
			// (e.g. user started a new task or a provider restart completed) during
			// the async operations above. Bail out if it no longer matches.
			const currentSession = this.options.sessions.getActiveSession()
			if (!currentSession || currentSession.sessionId !== oldSessionId) {
				Logger.log(
					`[SdkController] Active session changed during terminal mode restart (was ${oldSessionId}); aborting`,
				)
			return
			}

			const restartResult = await this.options.sessions.replaceActiveSession({
				startInput,
				initialMessages: initialMessages as InitialMessages,
				disposeReason: "terminalExecutionModeChange",
			})
			if (!restartResult) {
				return
			}

			const { startResult } = restartResult
			if (startResult.sessionId !== oldSessionId) {
				Logger.warn(
					`[SdkController] Terminal mode restart returned a new session ID (${startResult.sessionId}); preserving task ID ${oldSessionId} for UI continuity`,
				)
			}

			this.options.messages.emitSessionEvents([], {
				type: "status",
				payload: { sessionId: startResult.sessionId, status: "idle" },
			})

			await this.options.postStateToWebview()
			Logger.log(
				`[SdkController] Session restarted for terminal execution mode: ${oldSessionId} -> ${startResult.sessionId}`,
			)
		} catch (error) {
			Logger.error("[SdkController] Failed to restart session for terminal execution mode:", error)

			const errorMessage: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "error",
				text: `Failed to reload terminal tools: ${error instanceof Error ? error.message : String(error)}. Terminal timeout changes may not apply until the next task.`,
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

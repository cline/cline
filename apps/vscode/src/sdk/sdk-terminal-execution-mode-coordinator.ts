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
import { getEffectiveTerminalExecutionMode, type VscodeTerminalExecutionMode } from "./vscode-terminal-execution-mode"

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
	rebuilds: Pick<SdkSessionRebuildScheduler, "request">
}

export class SdkTerminalExecutionModeCoordinator {
	constructor(private readonly options: SdkTerminalExecutionModeCoordinatorOptions) {}

	handleTerminalExecutionModeChanged(previous: VscodeTerminalExecutionMode, next: VscodeTerminalExecutionMode): void {
		if (previous === next) {
			return
		}
		this.requestRebuild(`Terminal execution mode changed: ${previous} -> ${next}`)
	}

	/**
	 * The terminal profile selects the shell, and the run_commands tool
	 * description names that shell, so a profile change requires the same
	 * session rebuild as an execution mode change.
	 */
	handleTerminalProfileChanged(previous: string | undefined, next: string): void {
		if ((previous || "default") === (next || "default")) {
			return
		}
		this.requestRebuild(`Terminal profile changed: ${previous ?? "default"} -> ${next}`)
	}

	private requestRebuild(reason: string): void {
		Logger.log(`[SdkController] ${reason}`)

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			Logger.log("[SdkController] No active session - terminal mode tools will be picked up on next initTask")
			return
		}

		this.options.rebuilds.request("terminalExecutionMode", () => this.restartSessionForTerminalExecutionMode())
	}

	async restartSessionForTerminalExecutionMode(): Promise<void> {
		await this.performRestartSessionForTerminalExecutionMode()
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

			// Rebuilds may preserve the session ID, so identity is the only reliable
			// way to detect that another path replaced this session while we awaited.
			const currentSession = this.options.sessions.getActiveSession()
			if (!currentSession) {
				Logger.log(`[SdkController] Active session changed during terminal mode restart (was ${oldSessionId}); aborting`)
				return
			}
			if (currentSession !== activeSession || currentSession.isRunning) {
				Logger.log(
					`[SdkController] Active session changed or started running during terminal mode restart (was ${oldSessionId}); deferring`,
				)
				this.options.rebuilds.request("terminalExecutionMode", () => this.restartSessionForTerminalExecutionMode())
				return
			}

			const restartResult = await this.options.sessions.replaceActiveSession({
				expectedSession: activeSession,
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

import { createShellChangeNoticeTracker, type ShellChangeNotice, type ShellChangeNoticeTracker } from "@cline/shared"
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
	/**
	 * Maps a terminal profile ID to the shell it runs (getShellForProfile).
	 * Injected so shell-notice decisions are testable without VS Code config.
	 */
	resolveShellForProfile: (profileId: string) => string
}

export class SdkTerminalExecutionModeCoordinator {
	/**
	 * Pending shell change, stamped as an <environment_notice> onto the next
	 * outbound message by SdkSessionLifecycle.fireAndForgetSend. Tracked over
	 * resolved shells rather than profile IDs so profile changes that keep the
	 * same shell (e.g. "default" -> "powershell" where default is PowerShell)
	 * record nothing, and a round trip back to the shell the model last used
	 * cancels out. Session-scoped like SdkModeCoordinator's mode notice: the
	 * setting is global, so the notice stays pending for the recorded session
	 * even if the user visits another task before sending.
	 */
	private shellChangeNoticeTracker: ShellChangeNoticeTracker = createShellChangeNoticeTracker()
	private shellChangeNoticeSessionId: string | null = null

	constructor(private readonly options: SdkTerminalExecutionModeCoordinatorOptions) {}

	handleTerminalExecutionModeChanged(previous: VscodeTerminalExecutionMode, next: VscodeTerminalExecutionMode): void {
		if (previous === next) {
			return
		}
		// No shell notice: both modes resolve the shell from the same profile
		// setting, so the shell does not change with the execution mode.
		this.requestRebuild(`Terminal execution mode changed: ${previous} -> ${next}`)
	}

	/**
	 * The terminal profile selects the shell, and the run_commands tool
	 * description names that shell, so a profile change requires the same
	 * session rebuild as an execution mode change — plus a conversation
	 * notice, since the transcript's earlier commands still model the old
	 * shell's syntax.
	 */
	handleTerminalProfileChanged(previous: string | undefined, next: string): void {
		if ((previous || "default") === (next || "default")) {
			return
		}
		this.recordShellChangeNotice(previous || "default", next || "default")
		this.requestRebuild(`Terminal profile changed: ${previous ?? "default"} -> ${next}`)
	}

	/**
	 * Returns (and clears) the pending shell-change notice when the outbound
	 * message targets the session the change was recorded for; otherwise
	 * leaves it pending.
	 */
	consumeShellChangeNotice(sessionId: string): ShellChangeNotice | null {
		if (this.shellChangeNoticeSessionId !== sessionId) {
			return null
		}
		const notice = this.shellChangeNoticeTracker.consume()
		if (notice) {
			this.shellChangeNoticeSessionId = null
		}
		return notice
	}

	private recordShellChangeNotice(previousProfileId: string, nextProfileId: string): void {
		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			// No transcript to correct: a future session starts with the right
			// tool description and no momentum in the old shell.
			return
		}
		if (this.shellChangeNoticeSessionId !== activeSession.sessionId) {
			// A stale notice for another session is superseded rather than merged:
			// round-trip cancellation only makes sense within one transcript.
			this.shellChangeNoticeTracker = createShellChangeNoticeTracker()
		}
		this.shellChangeNoticeSessionId = activeSession.sessionId
		this.shellChangeNoticeTracker.record(
			this.options.resolveShellForProfile(previousProfileId),
			this.options.resolveShellForProfile(nextProfileId),
		)
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

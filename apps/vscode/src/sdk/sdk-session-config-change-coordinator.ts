import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkSessionRebuildScheduler, SessionRebuildContext, SessionRebuildReason } from "./sdk-session-rebuild-scheduler"
import type { SdkSessionHost } from "./session-host"
import type { VscodeSessionHost } from "./vscode-session-host"
import { getEffectiveTerminalExecutionMode, type VscodeTerminalExecutionMode } from "./vscode-terminal-execution-mode"

type StartInput = Parameters<VscodeSessionHost["start"]>[0]
type InitialMessages = StartInput["initialMessages"]
type SessionConfig = Awaited<ReturnType<SdkSessionConfigBuilder["build"]>>

export interface SdkSessionConfigChangeCoordinatorOptions {
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

interface RebuildDetails {
	reason: SessionRebuildReason
	description: string
	disposeReason: string
	failureMessage: string
}

export class SdkSessionConfigChangeCoordinator {
	constructor(private readonly options: SdkSessionConfigChangeCoordinatorOptions) {}

	handleTerminalExecutionModeChanged(previous: VscodeTerminalExecutionMode, next: VscodeTerminalExecutionMode): void {
		if (previous === next) {
			return
		}
		this.requestRebuild({
			reason: "terminalExecutionMode",
			description: `terminal execution mode ${previous} -> ${next}`,
			disposeReason: "terminalExecutionModeChange",
			failureMessage: "Failed to reload terminal tools. Terminal mode changes may not apply until the next task.",
		})
	}

	handleCheckpointsSettingChanged(previous: boolean, next: boolean): void {
		if (previous === next) {
			return
		}
		this.requestRebuild({
			reason: "checkpoints",
			description: `checkpoints ${previous ? "enabled" : "disabled"} -> ${next ? "enabled" : "disabled"}`,
			disposeReason: "checkpointsSettingChange",
			failureMessage: "Failed to reload checkpoint settings. The change may not apply until the next task.",
		})
	}

	private requestRebuild(details: RebuildDetails): void {
		Logger.log(`[SdkController] Session configuration changed: ${details.description}`)

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			Logger.log("[SdkController] No active session - configuration will be picked up on next initTask")
			return
		}

		this.options.rebuilds.request(details.reason, (context) => this.restartSession(details, context))
	}

	private async restartSession(details: RebuildDetails, context: SessionRebuildContext): Promise<void> {
		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			return
		}

		const { sdkHost: oldManager, sessionId: oldSessionId } = activeSession
		const terminalMode = getEffectiveTerminalExecutionMode(
			this.options.stateManager.getGlobalStateKey("vscodeTerminalExecutionMode"),
		)
		Logger.log(`[SdkController] Restarting session ${oldSessionId} for ${details.description}; terminal mode ${terminalMode}`)

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
			const pendingPrompts = await oldManager.pendingPrompts("list", { sessionId: oldSessionId })
			const startInput = this.options.buildStartSessionInput(config, { cwd, mode })

			// Rebuilds may preserve the session ID, so identity is the only reliable
			// way to detect that another path replaced this session while we awaited.
			const currentSession = this.options.sessions.getActiveSession()
			if (!currentSession) {
				Logger.log(`[SdkController] Active session ended during configuration restart (was ${oldSessionId}); aborting`)
				return
			}
			// A newer change for the same reason runs next, so this stale
			// configuration must not be installed. Nothing suspends between this
			// check and replaceActiveSession detaching the old session.
			if (!context.isCurrent()) {
				Logger.log(`[SdkController] Configuration restart superseded before replacing ${oldSessionId}; aborting`)
				return
			}
			if (currentSession !== activeSession || currentSession.isRunning) {
				Logger.log(
					`[SdkController] Active session changed or started running during configuration restart (was ${oldSessionId}); deferring`,
				)
				this.options.rebuilds.request(details.reason, (nextContext) => this.restartSession(details, nextContext))
				return
			}

			// replaceActiveSession detaches the old session synchronously before its
			// first suspension, so no send can enter it after this final state check.
			const restartResult = await this.options.sessions.replaceActiveSession({
				expectedSession: activeSession,
				startInput,
				initialMessages: initialMessages as InitialMessages,
				disposeReason: details.disposeReason,
			})
			if (!restartResult) {
				return
			}

			const { startResult, sdkHost } = restartResult
			if (startResult.sessionId !== oldSessionId) {
				Logger.warn(
					`[SdkController] Configuration restart returned a new session ID (${startResult.sessionId}); preserving task ID ${oldSessionId} for UI continuity`,
				)
			}

			// Prompts the user queued on the old session belong to the replacement.
			// The first one starts a turn, unless a newer change for the same
			// reason arrived while the replacement was starting: then every prompt
			// is re-queued so the newer rebuild carries them over before any turn
			// runs under this superseded configuration.
			const startsTurn = context.isCurrent()
			const [nextPrompt, ...remainingPrompts] = pendingPrompts
			if (nextPrompt && startsTurn) {
				this.options.sessions.setRunning(true)
				this.options.sessions.fireAndForgetSend(
					sdkHost,
					startResult.sessionId,
					nextPrompt.prompt,
					nextPrompt.userImages,
					nextPrompt.userFiles,
				)
			}
			const requeued = startsTurn ? remainingPrompts : pendingPrompts
			const replayOrder = [
				...requeued.filter((prompt) => prompt.delivery === "queue"),
				...requeued.filter((prompt) => prompt.delivery === "steer").reverse(),
			]
			for (const pendingPrompt of replayOrder) {
				await sdkHost.send({
					sessionId: startResult.sessionId,
					prompt: pendingPrompt.prompt,
					userImages: pendingPrompt.userImages,
					userFiles: pendingPrompt.userFiles,
					delivery: pendingPrompt.delivery,
				})
			}
			this.options.messages.emitSessionEvents([], {
				type: "status",
				payload: { sessionId: startResult.sessionId, status: nextPrompt && startsTurn ? "running" : "idle" },
			})

			await this.options.postStateToWebview()
			Logger.log(
				`[SdkController] Session restarted for ${details.description}: ${oldSessionId} -> ${startResult.sessionId}`,
			)
		} catch (error) {
			Logger.error(`[SdkController] Failed to restart session for ${details.description}:`, error)

			const errorMessage: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "error",
				text: `${details.failureMessage} ${error instanceof Error ? error.message : String(error)}`,
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

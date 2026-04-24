import type { SessionHost } from "@clinebot/core"
import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import type { SdkInteractionCoordinator } from "./sdk-interaction-coordinator"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import { isAbortError, type SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { TaskProxy } from "./task-proxy"
import type { VscodeSessionHost } from "./vscode-session-host"

type StartInput = Parameters<VscodeSessionHost["start"]>[0]
type InitialMessages = StartInput["initialMessages"]
type SessionConfig = Awaited<ReturnType<SdkSessionConfigBuilder["build"]>>

const ACT_MODE_CONTINUATION_PROMPT = "The user approved switching to act mode. Continue with the approved plan now."

export interface SdkModeCoordinatorOptions {
	stateManager: StateManager
	sessions: SdkSessionLifecycle
	interactions: SdkInteractionCoordinator
	messages: SdkMessageCoordinator
	sessionConfigBuilder: SdkSessionConfigBuilder
	getTask: () => TaskProxy | undefined
	getWorkspaceRoot: () => Promise<string>
	loadInitialMessages: (sessionManager: SessionHost, sessionId: string) => Promise<unknown[]>
	buildStartSessionInput: (config: SessionConfig, input: { cwd: string; mode: Mode }) => StartInput
	emitClineAuthError: () => void
	resetMessageTranslator: () => void
	postStateToWebview: () => Promise<void>
}

export class SdkModeCoordinator {
	private pendingModeChange: Mode | null = null

	constructor(private readonly options: SdkModeCoordinatorOptions) {}

	queueSwitchToActMode(): void {
		this.pendingModeChange = "act"
	}

	hasPendingModeChange(): boolean {
		return this.pendingModeChange !== null
	}

	async applyPendingModeChange(): Promise<void> {
		const target = this.pendingModeChange
		if (!target) {
			return
		}
		this.pendingModeChange = null
		Logger.log(`[SdkController] applyPendingModeChange: switching to ${target}`)
		await this.rebuildSessionForMode(target, { autoContinue: target === "act" })
	}

	async toggleActModeForYoloMode(): Promise<boolean> {
		const currentMode = this.options.stateManager.getGlobalSettingsKey("mode")
		if (currentMode === "act") {
			return false
		}
		await this.options.stateManager.setGlobalState("mode", "act")
		await this.options.postStateToWebview()
		return true
	}

	async togglePlanActMode(modeToSwitchTo: Mode): Promise<boolean> {
		const currentMode = this.options.stateManager.getGlobalSettingsKey("mode")
		if (currentMode === modeToSwitchTo) {
			return false
		}

		if (this.options.sessions.getActiveSession()) {
			await this.rebuildSessionForMode(modeToSwitchTo)
			return false
		}

		await this.options.stateManager.setGlobalState("mode", modeToSwitchTo)
		await this.options.postStateToWebview()
		return false
	}

	async rebuildSessionForMode(newMode: Mode, options: { autoContinue?: boolean } = {}): Promise<void> {
		await this.options.stateManager.setGlobalState("mode", newMode)

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			await this.options.postStateToWebview()
			return
		}

		const { sessionManager: oldManager, sessionId: oldSessionId } = activeSession
		const wasRunning = activeSession.isRunning

		Logger.log(`[SdkController] Rebuilding session ${oldSessionId} for mode change -> ${newMode} (wasRunning=${wasRunning})`)

		if (wasRunning) {
			await this.cancelRunningTurnForModeChange(oldManager, oldSessionId)
		}

		try {
			const initialMessages = await this.options.loadInitialMessages(oldManager, oldSessionId)
			const cwd = await this.options.getWorkspaceRoot()
			const config = await this.options.sessionConfigBuilder.build({ cwd, mode: newMode })
			Logger.log(
				`[SdkController] Mode rebuild config: mode=${newMode}, provider=${config.providerId}, model=${config.modelId}, hasApiKey=${!!config.apiKey}`,
			)
			config.sessionId = oldSessionId

			if (config.providerId === "cline" && !config.apiKey) {
				Logger.warn(
					`[SdkController] Mode rebuild: new mode '${newMode}' provider is 'cline' but no auth token - emitting auth error`,
				)
				this.options.emitClineAuthError()
				await this.options.postStateToWebview()
				return
			}

			const startInput = this.options.buildStartSessionInput(config, { cwd, mode: newMode })
			const rebuildResult = await this.options.sessions.replaceActiveSession({
				startInput,
				initialMessages: initialMessages as InitialMessages,
				disposeReason: "modeChange",
			})
			if (!rebuildResult) {
				return
			}

			const { sessionManager, startResult } = rebuildResult
			const task = this.options.getTask()
			if (task && task.taskId !== startResult.sessionId) {
				Logger.warn(
					`[SdkController] Mode rebuild returned a new session ID (${startResult.sessionId}); updating task proxy`,
				)
				task.taskId = startResult.sessionId
			}

			this.options.resetMessageTranslator()
			if (options.autoContinue) {
				this.options.sessions.setRunning(true)
				this.options.sessions.fireAndForgetSend(sessionManager, startResult.sessionId, ACT_MODE_CONTINUATION_PROMPT)
			}
			await this.options.postStateToWebview()

			Logger.log(`[SdkController] Session rebuilt for mode ${newMode}: ${oldSessionId} -> ${startResult.sessionId}`)
		} catch (error) {
			Logger.error("[SdkController] Failed to rebuild session for mode change:", error)
			const errorMessage: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "error",
				text: `Failed to switch mode: ${error instanceof Error ? error.message : String(error)}`,
				partial: false,
			}
			this.options.messages.appendAndEmit([errorMessage], {
				type: "status",
				payload: { sessionId: oldSessionId, status: "error" },
			})
			await this.options.postStateToWebview()
		}
	}

	private async cancelRunningTurnForModeChange(oldManager: SessionHost, oldSessionId: string): Promise<void> {
		this.options.interactions.clearPending("Mode changed")
		this.options.messages.cancelPendingSave()
		try {
			await oldManager.abort(oldSessionId)
		} catch (error) {
			if (!isAbortError(error)) {
				Logger.error("[SdkController] Failed to abort old session during mode change:", error)
			}
		}
		this.options.sessions.setRunning(false)

		const task = this.options.getTask()
		if (!task?.messageStateHandler) {
			return
		}

		const current = task.messageStateHandler.getClineMessages()
		const finalized = this.options.messages.finalizeMessagesForSave(current)
		this.options.messages.appendMessages(finalized, { save: false })

		if (!task.taskId || finalized.length === 0) {
			return
		}

		try {
			const { saveClineMessages } = await import("@core/storage/disk")
			await saveClineMessages(task.taskId, finalized)
		} catch (err) {
			Logger.error("[SdkController] Failed to persist finalized messages during mode rebuild:", err)
		}
	}
}

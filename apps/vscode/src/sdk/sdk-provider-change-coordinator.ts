import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkSessionHost } from "./session-host"
import type { TaskProxy } from "./task-proxy"
import type { VscodeSessionHost } from "./vscode-session-host"

type StartInput = Parameters<VscodeSessionHost["start"]>[0]
type InitialMessages = StartInput["initialMessages"]
type SessionConfig = Awaited<ReturnType<SdkSessionConfigBuilder["build"]>>

export interface SdkProviderChangeCoordinatorOptions {
	stateManager: StateManager
	sessions: SdkSessionLifecycle
	messages: SdkMessageCoordinator
	sessionConfigBuilder: SdkSessionConfigBuilder
	getTask: () => TaskProxy | undefined
	getWorkspaceRoot: () => Promise<string>
	loadInitialMessages: (sdkHost: SdkSessionHost, sessionId: string) => Promise<InitialMessages>
	buildStartSessionInput: (config: SessionConfig, input: { cwd: string; mode: Mode }) => StartInput
	postStateToWebview: () => Promise<void>
}

function providerForMode(config: ApiConfiguration, mode: Mode): string | undefined {
	return mode === "plan" ? config.planModeApiProvider : config.actModeApiProvider
}

export class SdkProviderChangeCoordinator {
	private restartPending = false
	private restartInFlight: Promise<void> | undefined

	constructor(private readonly options: SdkProviderChangeCoordinatorOptions) {}

	handleApiConfigurationChanged(previous: ApiConfiguration, next: ApiConfiguration): void {
		const mode = this.getCurrentMode()
		const previousProvider = providerForMode(previous, mode)
		const nextProvider = providerForMode(next, mode)

		if (previousProvider === nextProvider) {
			return
		}

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			Logger.log("[SdkController] Provider changed without active session; next task will use new provider")
			return
		}

		Logger.log(
			`[SdkController] Active provider changed for ${mode}: ${previousProvider ?? "none"} -> ${nextProvider ?? "none"}`,
		)

		if (activeSession.isRunning) {
			Logger.log("[SdkController] Session is mid-turn; deferring provider restart")
			this.restartPending = true
			return
		}

		this.restartActiveSessionForProviderChange().catch((error) => {
			Logger.error("[SdkController] Failed to restart session after provider change:", error)
		})
	}

	clearPendingRestart(): void {
		this.restartPending = false
	}

	async checkDeferredRestart(): Promise<void> {
		if (!this.restartPending) {
			return
		}
		this.restartPending = false

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			Logger.log("[SdkController] Deferred provider restart: no active session, skipping")
			return
		}

		if (activeSession.isRunning) {
			Logger.log("[SdkController] Deferred provider restart: session is still running")
			this.restartPending = true
			return
		}

		await this.restartActiveSessionForProviderChange()
	}

	async restartActiveSessionForProviderChange(): Promise<void> {
		if (this.restartInFlight) {
			this.restartPending = true
			return this.restartInFlight
		}

		const operation = this.performRestartActiveSessionForProviderChange()
		this.restartInFlight = operation.then(
			() => undefined,
			() => undefined,
		)

		try {
			await operation
		} finally {
			this.restartInFlight = undefined
			await this.checkDeferredRestart()
		}
	}

	private async performRestartActiveSessionForProviderChange(): Promise<void> {
		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			return
		}

		const { sdkHost: oldManager, sessionId: oldSessionId } = activeSession
		const cwd = await this.options.getWorkspaceRoot()
		const mode = this.getCurrentMode()

		Logger.log(`[SdkController] Restarting session ${oldSessionId} for provider change`)

		try {
			const config = await this.options.sessionConfigBuilder.build({ cwd, mode })
			config.sessionId = oldSessionId

			const initialMessages = await this.options.loadInitialMessages(oldManager, oldSessionId)
			const startInput = this.options.buildStartSessionInput(config, { cwd, mode })
			const restartResult = await this.options.sessions.replaceActiveSession({
				startInput,
				...(initialMessages ? { initialMessages } : {}),
				disposeReason: "providerChange",
			})
			if (!restartResult) {
				return
			}

			const { startResult } = restartResult
			const task = this.options.getTask()
			if (task && task.taskId !== startResult.sessionId) {
				Logger.warn(
					`[SdkController] Provider restart returned a new session ID (${startResult.sessionId}); updating task proxy`,
				)
				task.taskId = startResult.sessionId
			}

			await this.options.postStateToWebview()
			Logger.log(`[SdkController] Session restarted for provider change: ${oldSessionId} -> ${startResult.sessionId}`)
		} catch (error) {
			Logger.error("[SdkController] Failed to restart session for provider change:", error)
			this.options.messages.appendAndEmit(
				[
					{
						ts: Date.now(),
						type: "say",
						say: "error",
						text: `Failed to reload provider configuration: ${
							error instanceof Error ? error.message : String(error)
						}. The active session may still use the previous provider.`,
						partial: false,
					},
				],
				{ type: "status", payload: { sessionId: oldSessionId, status: "error" } },
			)
			await this.options.postStateToWebview()
		}
	}

	private getCurrentMode(): Mode {
		return this.options.stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
	}
}

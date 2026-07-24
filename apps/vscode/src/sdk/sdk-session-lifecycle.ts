import type {
	CoreSessionEvent,
	ITelemetryService,
	PreparedRemoteConfigCoreIntegration,
	RestoreInput,
	RestoreResult,
	StartSessionResult,
} from "@cline/core"
import { formatModeSwitchNotice, type ModeSwitchNotice } from "@cline/shared"
import { StateManager } from "@/core/storage/StateManager"
import type { VscodeTerminalManager } from "@/hosts/vscode/terminal/VscodeTerminalManager"
import { McpHub } from "@/services/mcp/McpHub"
import { Logger } from "@/shared/services/Logger"
import type { ActiveSession } from "./cline-session-factory"
import type { SdkForegroundCommandCoordinator } from "./sdk-foreground-command-coordinator"
import { buildToolPolicies } from "./sdk-tool-policies"
import type { SdkSessionHost } from "./session-host"
import { VscodeSessionHost } from "./vscode-session-host"

type RequestToolApprovalHandler = NonNullable<Parameters<typeof VscodeSessionHost.create>[0]["requestToolApproval"]>
type AskQuestionHandler = NonNullable<Parameters<typeof VscodeSessionHost.create>[0]["askQuestion"]>
type EditorExecutorHandler = NonNullable<Parameters<typeof VscodeSessionHost.create>[0]["editorExecutor"]>
type ApplyPatchExecutorHandler = NonNullable<Parameters<typeof VscodeSessionHost.create>[0]["applyPatchExecutor"]>

export interface SdkSessionLifecycleOptions {
	mcpHub: McpHub
	requestToolApproval: RequestToolApprovalHandler
	askQuestion: AskQuestionHandler
	/** Custom `editor` executor (diff-view edit pipeline); replaces the SDK's disk writer. */
	editorExecutor?: EditorExecutorHandler
	/** Custom `apply_patch` executor (reverts the diff preview, then applies via the SDK default). */
	applyPatchExecutor?: ApplyPatchExecutorHandler
	onSessionEvent: (event: CoreSessionEvent) => void
	/** Lazy factory for the VscodeTerminalManager (foreground terminal support). */
	getTerminalManager?: () => VscodeTerminalManager
	/** Registry of in-flight foreground executions for "Proceed While Running". */
	foregroundCommands?: SdkForegroundCommandCoordinator
	/** Returns the latest prepared remote-config integration, if remote config is active. */
	getRemoteConfigIntegration?: () => PreparedRemoteConfigCoreIntegration | undefined
	/** Shared SDK telemetry service owned by SdkController. */
	telemetry?: ITelemetryService
	onSendStart?: (sessionId: string) => void
	onSendComplete: (sessionId: string) => Promise<void> | void
	onSendError: (error: unknown, sessionId: string) => Promise<void> | void
	/**
	 * Returns (and clears) a pending user-initiated plan/act switch recorded by
	 * SdkModeCoordinator for this session, so fireAndForgetSend — the single
	 * funnel for outbound turn sends — can stamp a <mode_notice> onto the next
	 * message. Consumed exactly once; null when no switch is pending.
	 */
	consumeModeSwitchNotice?: (sessionId: string) => ModeSwitchNotice | null
	onDidBecomeIdle?: () => void
}

export class SdkSessionLifecycle {
	private activeSession: ActiveSession | undefined
	private sharedHost: SdkSessionHost | undefined
	private sharedHostPromise: Promise<SdkSessionHost> | undefined
	private sharedHostUnsubscribe: (() => void) | undefined
	/**
	 * Stops still in flight, keyed by sessionId. Mode/MCP rebuilds and
	 * follow-up resumes reuse the sessionId of the session they replace, and
	 * core cleanup is keyed by sessionId, so a same-id start that overlaps a
	 * stop would be torn down by the old session's late cleanup.
	 * startNewSession consults this map to enforce stop-before-start, the same
	 * sequencing the CLI uses.
	 */
	private readonly pendingStops = new Map<string, Promise<void>>()

	constructor(private readonly options: SdkSessionLifecycleOptions) {}

	getActiveSession(): ActiveSession | undefined {
		return this.activeSession
	}

	setRunning(isRunning: boolean): void {
		const activeSession = this.activeSession
		if (!activeSession || activeSession.isRunning === isRunning) {
			return
		}
		activeSession.isRunning = isRunning
		if (!isRunning) {
			this.options.onDidBecomeIdle?.()
		}
	}

	private clearActiveSessionReference(): ActiveSession | undefined {
		const activeSession = this.activeSession
		this.activeSession = undefined
		return activeSession
	}

	async endActiveSession(
		reason: string,
		options: { awaitStop?: boolean; timeoutMs?: number } = {},
	): Promise<ActiveSession | undefined> {
		const activeSession = this.clearActiveSessionReference()
		if (!activeSession) {
			return undefined
		}

		this.safeUnsubscribe(activeSession, reason)
		const stopPromise = this.trackSessionStop(activeSession.sdkHost, activeSession.sessionId, reason)
		if (options.awaitStop) {
			const timeoutMs = options.timeoutMs ?? 3000
			const stopped = await this.waitForStop(stopPromise, timeoutMs)
			if (!stopped) {
				Logger.warn(
					`[SdkController] Timed out stopping SDK session ${activeSession.sessionId} after ${timeoutMs}ms (${reason})`,
				)
			}
		}
		return activeSession
	}

	async updateActiveSessionModel(modelId: string): Promise<boolean> {
		const activeSession = this.activeSession
		if (!activeSession?.sdkHost.updateSessionModel) {
			return false
		}

		await activeSession.sdkHost.updateSessionModel(activeSession.sessionId, modelId)
		return true
	}

	async startNewSession(
		startInput: Parameters<VscodeSessionHost["start"]>[0],
	): Promise<{ startResult: StartSessionResult; sdkHost: SdkSessionHost }> {
		if (this.activeSession) {
			await this.endActiveSession("startNewSession")
		}

		// Same-id starts must wait for the previous session's stop to finish;
		// see pendingStops. A fresh id cannot conflict, so it never waits.
		const requestedSessionId = startInput.config?.sessionId?.trim()
		const pendingStop = requestedSessionId ? this.pendingStops.get(requestedSessionId) : undefined
		if (pendingStop) {
			Logger.log(`[SdkController] Waiting for session ${requestedSessionId} to stop before restarting it`)
			await pendingStop
		}

		const autoApprovalSettings = StateManager.get().getGlobalSettingsKey("autoApprovalSettings")
		const toolPolicies = autoApprovalSettings ? buildToolPolicies(autoApprovalSettings, this.options.mcpHub) : undefined

		const sdkHost = await this.getOrCreateSharedHost()

		const startResult = await sdkHost.start({
			...startInput,
			...(toolPolicies ? { toolPolicies } : {}),
		})
		this.activeSession = {
			sessionId: startResult.sessionId,
			startConfig: startInput.config
				? {
						providerId: startInput.config.providerId,
						modelId: startInput.config.modelId,
					}
				: undefined,
			sdkHost,
			unsubscribe: () => {},
			startResult,
			isRunning: true,
		}

		return { startResult, sdkHost }
	}

	async replaceActiveSession(options: {
		expectedSession: ActiveSession
		startInput: Parameters<VscodeSessionHost["start"]>[0]
		initialMessages?: Parameters<VscodeSessionHost["start"]>[0]["initialMessages"]
		disposeReason: string
	}): Promise<
		| {
				oldSessionId: string
				startResult: StartSessionResult
				sdkHost: SdkSessionHost
		  }
		| undefined
	> {
		const oldSession = this.activeSession
		if (!oldSession || oldSession !== options.expectedSession || oldSession.isRunning) {
			return undefined
		}

		const { sessionId: oldSessionId } = oldSession

		// No need to await the stop here: callers reuse oldSessionId in the
		// startInput, and startNewSession waits on the pending stop for it.
		await this.endActiveSession(options.disposeReason)

		const { startResult, sdkHost } = await this.startNewSession({
			...options.startInput,
			...(options.initialMessages ? { initialMessages: options.initialMessages } : {}),
		})
		this.setRunning(false)

		return { oldSessionId, startResult, sdkHost }
	}

	async restoreActiveSession(input: RestoreInput): Promise<RestoreResult> {
		const activeSession = this.activeSession
		if (!activeSession) {
			throw new Error("No active SDK session to restore")
		}

		const sourceSessionId = activeSession.sessionId
		const restored = await activeSession.sdkHost.restore(input)
		if (!restored.startResult || !restored.sessionId) {
			return restored
		}

		this.activeSession = {
			...activeSession,
			sessionId: restored.sessionId,
			startConfig: input.start?.config
				? {
						providerId: input.start.config.providerId,
						modelId: input.start.config.modelId,
					}
				: activeSession.startConfig,
			startResult: restored.startResult,
			isRunning: false,
		}

		if (restored.sessionId !== sourceSessionId) {
			const stopPromise = this.trackSessionStop(activeSession.sdkHost, sourceSessionId, "restoreActiveSession")
			stopPromise.catch((error) => {
				Logger.warn(`[SdkController] Failed to stop source session after checkpoint restore: ${sourceSessionId}`, error)
			})
		}

		return restored
	}

	async dispose(reason = "SdkSessionLifecycle.dispose"): Promise<void> {
		await this.endActiveSession(reason, { awaitStop: true })

		const sharedHost = this.sharedHost ?? (await this.sharedHostPromise?.catch(() => undefined))
		this.sharedHost = undefined
		this.sharedHostPromise = undefined
		this.sharedHostUnsubscribe?.()
		this.sharedHostUnsubscribe = undefined
		await sharedHost?.dispose(reason)
	}

	private createSafeUnsubscribe(unsubscribe: () => void, label: string): () => void {
		let unsubscribed = false
		return () => {
			if (unsubscribed) {
				return
			}
			unsubscribed = true
			try {
				unsubscribe()
			} catch (error) {
				Logger.warn(`[SdkController] Failed to unsubscribe SDK session listener (${label}):`, error)
			}
		}
	}

	private safeUnsubscribe(activeSession: ActiveSession, reason: string): void {
		activeSession.unsubscribe()
		Logger.debug(`[SdkController] Unsubscribed SDK session listener: ${activeSession.sessionId} (${reason})`)
	}

	private ensureSharedHostSubscription(sdkHost: SdkSessionHost): void {
		if (this.sharedHostUnsubscribe) {
			return
		}
		this.sharedHostUnsubscribe = this.createSafeUnsubscribe(sdkHost.subscribe(this.options.onSessionEvent), "shared-host")
	}

	/**
	 * Starts the session's stop and records it in pendingStops until it
	 * settles. The returned promise never rejects.
	 */
	private trackSessionStop(sdkHost: SdkSessionHost, sessionId: string, reason: string): Promise<void> {
		const startedAt = Date.now()
		const stopPromise = sdkHost
			.stop(sessionId)
			.then(() => {
				const elapsed = Date.now() - startedAt
				if (elapsed > 250) {
					Logger.log(`[SdkController] SDK session ${sessionId} stopped in ${elapsed}ms (${reason})`)
				}
			})
			.catch((error: unknown) => {
				Logger.warn(`[SdkController] Failed to stop SDK session ${sessionId} (${reason}):`, error)
			})
			.finally(() => {
				if (this.pendingStops.get(sessionId) === stopPromise) {
					this.pendingStops.delete(sessionId)
				}
			})
		this.pendingStops.set(sessionId, stopPromise)
		return stopPromise
	}

	private async waitForStop(stopPromise: Promise<void>, timeoutMs: number): Promise<boolean> {
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined
		try {
			const timeout = new Promise<"timeout">((resolve) => {
				timeoutHandle = setTimeout(() => resolve("timeout"), timeoutMs)
			})
			const result = await Promise.race([stopPromise.then(() => "stopped" as const), timeout])
			return result === "stopped"
		} finally {
			clearTimeout(timeoutHandle)
		}
	}

	private async getOrCreateSharedHost(): Promise<SdkSessionHost> {
		if (this.sharedHost) {
			this.ensureSharedHostSubscription(this.sharedHost)
			return this.sharedHost
		}
		if (!this.sharedHostPromise) {
			// Host-lifetime dependencies only. Anything task/session-specific must be
			// supplied to sdkHost.start(...), otherwise it can leak across reused sessions.
			this.sharedHostPromise = VscodeSessionHost.create({
				mcpHub: this.options.mcpHub,
				requestToolApproval: this.options.requestToolApproval,
				askQuestion: this.options.askQuestion,
				editorExecutor: this.options.editorExecutor,
				applyPatchExecutor: this.options.applyPatchExecutor,
				getTerminalManager: this.options.getTerminalManager,
				foregroundCommands: this.options.foregroundCommands,
				getRemoteConfigIntegration: this.options.getRemoteConfigIntegration,
				telemetry: this.options.telemetry,
			})
				.then((sdkHost) => {
					this.ensureSharedHostSubscription(sdkHost)
					this.sharedHost = sdkHost
					return sdkHost
				})
				.finally(() => {
					this.sharedHostPromise = undefined
				})
		}
		return this.sharedHostPromise
	}

	fireAndForgetSend(
		sdkHost: SdkSessionHost,
		sessionId: string,
		prompt: string,
		images?: string[],
		files?: string[],
		delivery?: "queue" | "steer",
	): void {
		// Captured by object identity, not sessionId: rebuilds (mode change) reuse
		// the same sessionId for the replacement session, so only reference
		// equality can tell this send's session apart from a successor. If the
		// session was replaced by the time the send settles, the settle callbacks
		// must not run bookkeeping against the successor (e.g. flipping a live
		// auto-continued run to isRunning=false, which makes the event coordinator
		// treat the new turn's completion as a cancelled-turn straggler).
		const sessionAtSend = this.activeSession
		const isSuperseded = (label: string): boolean => {
			if (this.activeSession === sessionAtSend) {
				return false
			}
			Logger.debug(`[SdkController] Ignoring ${label} of superseded send for session: ${sessionId}`)
			return true
		}
		// Mark a preceding user-initiated mode switch on this message so the model
		// sees exactly when the rules changed, instead of only inferring it from
		// the user_input mode attribute flipping (mirrors the CLI's
		// run-interactive stamping). The notice survives prepareTurnInput's
		// normalizeUserInput sanitize and is hidden from display surfaces by
		// stripModeNotices.
		const notice = this.options.consumeModeSwitchNotice?.(sessionId)
		const noticedPrompt = notice ? `${formatModeSwitchNotice(notice.from, notice.to)}\n${prompt}` : prompt
		this.options.onSendStart?.(sessionId)
		sdkHost
			.send({
				sessionId,
				prompt: noticedPrompt,
				userImages: images,
				userFiles: files,
				delivery,
			})
			.then(async () => {
				if (delivery === "queue" || delivery === "steer") {
					Logger.log(`[SdkController] Message queued for session: ${sessionId}`)
					return
				}
				if (isSuperseded("completion")) {
					return
				}
				Logger.log(`[SdkController] Agent turn completed for session: ${sessionId}`)
				this.setRunning(false)
				await this.options.onSendComplete(sessionId)
			})
			.catch(async (error: unknown) => {
				if (isAbortError(error)) {
					Logger.debug(`[SdkController] Agent turn aborted (expected): ${sessionId}`)
					return
				}
				if (isSuperseded("failure")) {
					return
				}
				Logger.error("[SdkController] Agent turn failed:", error)
				this.setRunning(false)
				await this.options.onSendError(error, sessionId)
			})
	}
}

export function isAbortError(error: unknown): boolean {
	if (error instanceof Error) {
		return error.name === "AbortError" || error.message.toLowerCase().includes("aborted")
	}
	return false
}

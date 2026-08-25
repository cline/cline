import type { ConnectionUpdate } from "@cline/core"
import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import type { StateManager } from "@/core/storage/StateManager"
import { toLegacyApiProvider } from "@/shared/model-catalog/provider-helpers"
import { Logger } from "@/shared/services/Logger"
import type { ProviderId } from "./model-catalog/contracts"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkSessionRebuildScheduler } from "./sdk-session-rebuild-scheduler"
import type { SdkSessionHost } from "./session-host"
import type { TaskProxy } from "./task-proxy"
import type { VscodeSessionHost } from "./vscode-session-host"

type StartInput = Parameters<VscodeSessionHost["start"]>[0]
type InitialMessages = StartInput["initialMessages"]
type SessionConfig = Awaited<ReturnType<SdkSessionConfigBuilder["build"]>>
type ActiveSession = NonNullable<ReturnType<SdkSessionLifecycle["getActiveSession"]>>

interface PendingProviderFieldUpdate {
	version: number
	mode: Mode
	provider: string
	activeSession: ActiveSession
}

interface ProviderReplacementContext {
	activeSession: ActiveSession
	mode: Mode
	provider: string | undefined
	versionAtStart: number
	providerOwned: boolean
	depth: number
	replacementSession?: ActiveSession
}

const PROVIDER_FIELDS_REBUILD_DEBOUNCE_MS = 300

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
	rebuilds: Pick<SdkSessionRebuildScheduler, "request">
}

function providerForMode(config: ApiConfiguration, mode: Mode): string | undefined {
	const provider = mode === "plan" ? config.planModeApiProvider : config.actModeApiProvider
	// Compare canonical spellings: previously-persisted snapshots can still
	// hold SDK ids like `openai-compatible` while new writes use the legacy
	// `openai` spelling; a spelling-only difference must not be treated as a
	// provider switch (it would restart the active session for nothing).
	return provider === undefined ? undefined : toLegacyApiProvider(provider)
}

function providerForSession(session: ActiveSession): string | undefined {
	// A same-id replacement seeded with history can return the persisted
	// manifest from the previous runtime. The lifecycle-owned start config is
	// the authoritative identity of the installed replacement.
	const provider = session.startConfig?.providerId?.trim() || session.startResult?.manifest?.provider?.trim()
	return provider === undefined ? undefined : toLegacyApiProvider(provider)
}

export class SdkProviderChangeCoordinator {
	private providerFieldsRebuildTimer: ReturnType<typeof setTimeout> | undefined
	private pendingProviderFieldsRebuild: (() => void) | undefined
	private providerConnectionChangeVersion = 0
	private appliedProviderConnectionVersion = 0
	private pendingProviderFieldUpdate: PendingProviderFieldUpdate | undefined
	private providerConnectionApplyTail: Promise<void> = Promise.resolve()
	private sessionReplacementInFlight: ProviderReplacementContext | undefined

	constructor(private readonly options: SdkProviderChangeCoordinatorOptions) {}

	handleProviderConfigFieldsChanged(providerId: ProviderId): void {
		const mode = this.getCurrentMode()
		const activeProvider = providerForMode(this.options.stateManager.getApiConfiguration(), mode)
		const changedProvider = toLegacyApiProvider(providerId)

		if (activeProvider !== changedProvider) {
			return
		}

		const replacement = this.sessionReplacementInFlight
		const installedSession = this.options.sessions.getActiveSession()
		const activeSession =
			installedSession ??
			(replacement?.mode === mode && replacement.provider === changedProvider ? replacement.activeSession : undefined)
		if (!activeSession) {
			Logger.log("[SdkController] Provider fields changed without active session; next task will use new configuration")
			return
		}
		const version = ++this.providerConnectionChangeVersion
		this.pendingProviderFieldUpdate = {
			version,
			mode,
			provider: changedProvider,
			activeSession,
		}

		const sessionUsesChangedProvider = providerForSession(activeSession) === changedProvider
		const matchingReplacementInFlight =
			replacement?.activeSession === activeSession && replacement.mode === mode && replacement.provider === changedProvider
		if (!sessionUsesChangedProvider && !matchingReplacementInFlight) {
			// The selected provider can change while the previous provider's turn is
			// still running. Never hot-apply the newly selected provider's credentials
			// to that old session; let the already-queued full replacement (or this
			// field-change rebuild) install them on a matching session instead.
			Logger.log(
				`[SdkController] Deferring ${changedProvider} field refresh until the active ${providerForSession(activeSession) ?? "unknown"} session is rebuilt`,
			)
			this.scheduleProviderFieldsRebuild(mode, changedProvider, activeSession)
			return
		}

		this.scheduleProviderFieldsRebuild(mode, changedProvider, activeSession)
	}

	private scheduleProviderFieldsRebuild(mode: Mode, provider: string, activeSession: ActiveSession): void {
		this.cancelPendingProviderFieldsRebuild()
		this.pendingProviderFieldsRebuild = () => {
			const currentMode = this.getCurrentMode()
			const currentProvider = providerForMode(this.options.stateManager.getApiConfiguration(), currentMode)
			if (
				currentProvider !== provider ||
				currentMode !== mode ||
				this.options.sessions.getActiveSession() !== activeSession
			) {
				return
			}

			Logger.log(`[SdkController] Active provider fields changed for ${currentMode}: ${provider}`)
			this.options.rebuilds.request("provider", () => this.performRestartActiveSessionForProviderChange(activeSession))
		}
		this.providerFieldsRebuildTimer = setTimeout(
			() => this.flushPendingProviderFieldsRebuild(),
			PROVIDER_FIELDS_REBUILD_DEBOUNCE_MS,
		)
	}

	handleApiConfigurationChanged(previous: ApiConfiguration, next: ApiConfiguration): void {
		const mode = this.getCurrentMode()
		const previousProvider = providerForMode(previous, mode)
		const nextProvider = providerForMode(next, mode)

		if (previousProvider === nextProvider) {
			return
		}

		this.cancelPendingProviderFieldsRebuild()
		// Provider switches retain their existing restart semantics. The live
		// connection bridge below is only for field edits on the active provider.
		this.providerConnectionChangeVersion += 1
		this.appliedProviderConnectionVersion = this.providerConnectionChangeVersion
		this.pendingProviderFieldUpdate = undefined

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			Logger.log("[SdkController] Provider changed without active session; next task will use new provider")
			return
		}

		Logger.log(
			`[SdkController] Active provider changed for ${mode}: ${previousProvider ?? "none"} -> ${nextProvider ?? "none"}`,
		)

		this.options.rebuilds.request("provider", () => this.performRestartActiveSessionForProviderChange(activeSession))
	}

	async restartActiveSessionForProviderChange(): Promise<void> {
		await this.performRestartActiveSessionForProviderChange()
	}

	/**
	 * Retains provider-field edits while any coordinator replaces the active
	 * session. Calls may nest because the provider coordinator owns the wider
	 * rebuild while SdkSessionLifecycle owns the exact reference-free gap.
	 */
	handleActiveSessionReplacementStarted(activeSession: ActiveSession): void {
		this.beginActiveSessionReplacement(activeSession, false)
	}

	private beginActiveSessionReplacement(activeSession: ActiveSession, providerOwned: boolean): void {
		const current = this.sessionReplacementInFlight
		if (current?.activeSession === activeSession) {
			current.providerOwned ||= providerOwned
			current.depth += 1
			return
		}

		const mode = this.getCurrentMode()
		this.sessionReplacementInFlight = {
			activeSession,
			mode,
			provider: providerForMode(this.options.stateManager.getApiConfiguration(), mode),
			versionAtStart: this.providerConnectionChangeVersion,
			providerOwned,
			depth: 1,
		}
	}

	handleActiveSessionReplacementFinished(replacementSession: ActiveSession | undefined): void {
		const context = this.sessionReplacementInFlight
		if (!context) {
			return
		}

		if (replacementSession) {
			context.replacementSession = replacementSession
		}
		context.depth -= 1
		if (context.depth > 0) {
			return
		}

		this.sessionReplacementInFlight = undefined
		this.rebindProviderEditAfterReplacement(context, context.replacementSession)
	}

	/**
	 * Applies connection-scoped provider settings to a suspended live session.
	 * The scheduled rebuild is intentionally retained: once the turn becomes
	 * idle it still refreshes session-wide fields that an in-place connection update
	 * cannot change (for example system-prompt/model metadata).
	 */
	async applyPendingConnectionUpdateBeforeModelRequest(): Promise<void> {
		const apply = this.providerConnectionApplyTail.then(() => this.performPendingConnectionUpdate())
		this.providerConnectionApplyTail = apply.catch(() => {})
		await apply
	}

	private async performPendingConnectionUpdate(): Promise<void> {
		while (true) {
			const pending = this.pendingProviderFieldUpdate
			if (!pending || pending.version <= this.appliedProviderConnectionVersion) return
			if (this.classifyPendingProviderFieldUpdate(pending) !== "current") return

			const cwd = await this.options.getWorkspaceRoot()
			const workspaceStatus = this.classifyPendingProviderFieldUpdate(pending)
			if (workspaceStatus === "superseded") continue
			if (workspaceStatus === "invalid") return
			const config = await this.options.sessionConfigBuilder.build({ cwd, mode: pending.mode })
			const buildStatus = this.classifyPendingProviderFieldUpdate(pending)
			if (buildStatus === "superseded") continue
			if (buildStatus === "invalid") return
			if (toLegacyApiProvider(config.providerId) !== pending.provider) return

			const updateSuspendedConnection = pending.activeSession.sdkHost.updateSuspendedSessionConnection
			if (!updateSuspendedConnection) {
				throw new Error("Active SDK host cannot update suspended provider settings")
			}

			const hasReasoningConfig =
				config.thinking !== undefined || config.reasoningEffort !== undefined || config.thinkingBudgetTokens !== undefined
			const update: ConnectionUpdate = {
				apiKey: config.apiKey ?? "",
				baseUrl: config.baseUrl ?? "",
				headers: config.headers ?? {},
				providerConfig: config.providerConfig,
				thinking: hasReasoningConfig ? (config.thinking ?? true) : null,
				reasoningEffort: config.reasoningEffort ?? null,
				thinkingBudgetTokens: config.thinkingBudgetTokens ?? null,
			}
			await updateSuspendedConnection.call(pending.activeSession.sdkHost, pending.activeSession.sessionId, update)
			const updateStatus = this.classifyPendingProviderFieldUpdate(pending)
			if (updateStatus === "superseded") continue
			if (updateStatus === "current") {
				this.appliedProviderConnectionVersion = pending.version
			}
			return
		}
	}

	private classifyPendingProviderFieldUpdate(pending: PendingProviderFieldUpdate): "current" | "superseded" | "invalid" {
		const latest = this.pendingProviderFieldUpdate
		if (!latest) return "invalid"
		const sameExecutionContext =
			latest.activeSession === pending.activeSession && latest.mode === pending.mode && latest.provider === pending.provider
		const executionContextStillActive =
			this.options.sessions.getActiveSession() === pending.activeSession &&
			providerForSession(pending.activeSession) === pending.provider &&
			this.getCurrentMode() === pending.mode &&
			providerForMode(this.options.stateManager.getApiConfiguration(), pending.mode) === pending.provider

		if (!sameExecutionContext || !executionContextStillActive) return "invalid"
		if (latest === pending && this.providerConnectionChangeVersion === pending.version) return "current"
		if (latest.version > pending.version && this.providerConnectionChangeVersion === latest.version) return "superseded"
		return "invalid"
	}

	flushPendingProviderFieldsRebuild(): void {
		const pendingRebuild = this.pendingProviderFieldsRebuild
		if (!pendingRebuild) {
			return
		}

		if (this.providerFieldsRebuildTimer !== undefined) {
			clearTimeout(this.providerFieldsRebuildTimer)
		}
		this.providerFieldsRebuildTimer = undefined
		this.pendingProviderFieldsRebuild = undefined
		pendingRebuild()
	}

	private async performRestartActiveSessionForProviderChange(expectedSession?: ActiveSession): Promise<void> {
		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession || (expectedSession && activeSession !== expectedSession)) {
			return
		}
		const { sdkHost: oldManager, sessionId: oldSessionId } = activeSession
		const cwd = await this.options.getWorkspaceRoot()
		const mode = this.getCurrentMode()
		this.beginActiveSessionReplacement(activeSession, true)
		let replacementInstalled = false

		Logger.log(`[SdkController] Restarting session ${oldSessionId} for provider change`)

		try {
			const config = await this.options.sessionConfigBuilder.build({ cwd, mode })
			config.sessionId = oldSessionId

			const initialMessages = await this.options.loadInitialMessages(oldManager, oldSessionId)
			const startInput = this.options.buildStartSessionInput(config, { cwd, mode })
			const restartResult = await this.options.sessions.replaceActiveSession({
				expectedSession: activeSession,
				startInput,
				...(initialMessages ? { initialMessages } : {}),
				disposeReason: "providerChange",
			})
			if (!restartResult) {
				return
			}
			replacementInstalled = true

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
		} finally {
			this.handleActiveSessionReplacementFinished(
				replacementInstalled ? this.options.sessions.getActiveSession() : undefined,
			)
		}
	}

	private rebindProviderEditAfterReplacement(
		context: ProviderReplacementContext,
		replacementSession: ActiveSession | undefined,
	): void {
		const latestPending = this.pendingProviderFieldUpdate
		const pendingMatchesReplacement =
			replacementSession !== undefined &&
			latestPending !== undefined &&
			latestPending.mode === context.mode &&
			latestPending.provider === context.provider &&
			providerForSession(replacementSession) === context.provider &&
			this.getCurrentMode() === context.mode &&
			providerForMode(this.options.stateManager.getApiConfiguration(), context.mode) === context.provider
		const editNeedsRefresh =
			pendingMatchesReplacement && (!context.providerOwned || latestPending.version > context.versionAtStart)
		if (editNeedsRefresh) {
			this.pendingProviderFieldUpdate = {
				...latestPending,
				activeSession: replacementSession,
			}
			this.scheduleProviderFieldsRebuild(latestPending.mode, latestPending.provider, replacementSession)
			return
		}

		// A successful provider-owned rebuild began before it snapshotted config.
		// An older pending edit was therefore included in that replacement and
		// must not schedule another identical rebuild. Other coordinators begin
		// tracking only after their config snapshot, so they conservatively rebind
		// any matching pending edit above. A failed/refused rebuild has no
		// replacementSession and must retain the edit for the next request.
		if (
			context.providerOwned &&
			replacementSession !== undefined &&
			latestPending?.activeSession === context.activeSession &&
			latestPending.mode === context.mode &&
			latestPending.provider === context.provider &&
			latestPending.version <= context.versionAtStart
		) {
			this.appliedProviderConnectionVersion = Math.max(this.appliedProviderConnectionVersion, latestPending.version)
			this.pendingProviderFieldUpdate = undefined
		}
	}

	private getCurrentMode(): Mode {
		return this.options.stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
	}

	private cancelPendingProviderFieldsRebuild(): void {
		if (this.providerFieldsRebuildTimer !== undefined) {
			clearTimeout(this.providerFieldsRebuildTimer)
			this.providerFieldsRebuildTimer = undefined
		}
		this.pendingProviderFieldsRebuild = undefined
	}
}

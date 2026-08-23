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

export class SdkProviderChangeCoordinator {
	private providerFieldsRebuildTimer: ReturnType<typeof setTimeout> | undefined
	private pendingProviderFieldsRebuild: (() => void) | undefined
	private providerConnectionChangeVersion = 0
	private appliedProviderConnectionVersion = 0

	constructor(private readonly options: SdkProviderChangeCoordinatorOptions) {}

	handleProviderConfigFieldsChanged(providerId: ProviderId): void {
		const mode = this.getCurrentMode()
		const activeProvider = providerForMode(this.options.stateManager.getApiConfiguration(), mode)
		const changedProvider = toLegacyApiProvider(providerId)

		if (activeProvider !== changedProvider) {
			return
		}

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			Logger.log("[SdkController] Provider fields changed without active session; next task will use new configuration")
			return
		}
		this.providerConnectionChangeVersion += 1

		this.cancelPendingProviderFieldsRebuild()
		this.pendingProviderFieldsRebuild = () => {
			const currentMode = this.getCurrentMode()
			const currentProvider = providerForMode(this.options.stateManager.getApiConfiguration(), currentMode)
			if (currentProvider !== changedProvider || this.options.sessions.getActiveSession() !== activeSession) {
				return
			}

			Logger.log(`[SdkController] Active provider fields changed for ${currentMode}: ${changedProvider}`)
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
		this.appliedProviderConnectionVersion = this.providerConnectionChangeVersion

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
	 * Applies connection-scoped provider settings to a suspended live session.
	 * The scheduled rebuild is intentionally retained: once the turn becomes
	 * idle it still refreshes session-wide fields that updateSessionConnection
	 * cannot change (for example system-prompt/model metadata).
	 */
	async applyPendingConnectionUpdateBeforeInteractionResume(): Promise<void> {
		while (this.appliedProviderConnectionVersion < this.providerConnectionChangeVersion) {
			const targetVersion = this.providerConnectionChangeVersion
			const activeSession = this.options.sessions.getActiveSession()
			if (!activeSession) {
				return
			}
			if (!activeSession.sdkHost.updateSessionConnection) {
				throw new Error("Active SDK host cannot update provider settings without restarting")
			}

			const cwd = await this.options.getWorkspaceRoot()
			const mode = this.getCurrentMode()
			const config = await this.options.sessionConfigBuilder.build({ cwd, mode })
			if (this.options.sessions.getActiveSession() !== activeSession) {
				continue
			}

			const hasReasoningConfig =
				config.thinking !== undefined || config.reasoningEffort !== undefined || config.thinkingBudgetTokens !== undefined
			const update: ConnectionUpdate = {
				providerId: config.providerId,
				modelId: config.modelId,
				apiKey: config.apiKey ?? "",
				baseUrl: config.baseUrl ?? "",
				headers: config.headers ?? {},
				providerConfig: config.providerConfig,
				thinking: hasReasoningConfig ? (config.thinking ?? true) : null,
				reasoningEffort: config.reasoningEffort ?? null,
				thinkingBudgetTokens: config.thinkingBudgetTokens ?? null,
			}
			await activeSession.sdkHost.updateSessionConnection(activeSession.sessionId, update)
			if (this.options.sessions.getActiveSession() === activeSession) {
				this.appliedProviderConnectionVersion = targetVersion
			}
		}
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
		const providerConnectionVersion = this.providerConnectionChangeVersion

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

			const { startResult } = restartResult
			const task = this.options.getTask()
			if (task && task.taskId !== startResult.sessionId) {
				Logger.warn(
					`[SdkController] Provider restart returned a new session ID (${startResult.sessionId}); updating task proxy`,
				)
				task.taskId = startResult.sessionId
			}

			await this.options.postStateToWebview()
			this.appliedProviderConnectionVersion = Math.max(this.appliedProviderConnectionVersion, providerConnectionVersion)
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

	private cancelPendingProviderFieldsRebuild(): void {
		if (this.providerFieldsRebuildTimer !== undefined) {
			clearTimeout(this.providerFieldsRebuildTimer)
			this.providerFieldsRebuildTimer = undefined
		}
		this.pendingProviderFieldsRebuild = undefined
	}
}

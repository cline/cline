import type { CoreSessionEvent, PreparedRemoteConfigCoreIntegration, StartSessionResult } from "@cline/core"
import { StateManager } from "@/core/storage/StateManager"
import { ITerminalManager } from "@/integrations/terminal"
import { McpHub } from "@/services/mcp/McpHub"
import { Logger } from "@/shared/services/Logger"
import type { ActiveSession } from "./cline-session-factory"
import { buildToolPolicies } from "./sdk-tool-policies"
import type { SdkSessionHost } from "./session-host"
import { VscodeSessionHost } from "./vscode-session-host"

export type RequestToolApprovalHandler = NonNullable<Parameters<typeof VscodeSessionHost.create>[0]["requestToolApproval"]>
export type AskQuestionHandler = NonNullable<Parameters<typeof VscodeSessionHost.create>[0]["askQuestion"]>

export interface SdkSessionLifecycleOptions {
	mcpHub: McpHub
	requestToolApproval: RequestToolApprovalHandler
	askQuestion: AskQuestionHandler
	onSessionEvent: (event: CoreSessionEvent) => void
	/** Lazy factory for the VscodeTerminalManager (foreground terminal support). */
	getTerminalManager?: () => ITerminalManager
	/** Returns the latest prepared remote-config integration, if remote config is active. */
	getRemoteConfigIntegration?: () => PreparedRemoteConfigCoreIntegration | undefined
	onSendComplete: (sessionId: string) => Promise<void> | void
	onSendError: (error: unknown, sessionId: string) => Promise<void> | void
}

export class SdkSessionLifecycle {
	private activeSession: ActiveSession | undefined

	constructor(private readonly options: SdkSessionLifecycleOptions) {}

	getActiveSession(): ActiveSession | undefined {
		return this.activeSession
	}

	setRunning(isRunning: boolean): void {
		if (this.activeSession) {
			this.activeSession.isRunning = isRunning
		}
	}

	clearActiveSessionReference(): ActiveSession | undefined {
		const activeSession = this.activeSession
		this.activeSession = undefined
		return activeSession
	}

	async startNewSession(
		startInput: Parameters<VscodeSessionHost["start"]>[0],
	): Promise<{ startResult: StartSessionResult; sdkHost: SdkSessionHost }> {
		const autoApprovalSettings = StateManager.get().getGlobalSettingsKey("autoApprovalSettings")
		const toolPolicies = autoApprovalSettings ? buildToolPolicies(autoApprovalSettings, this.options.mcpHub) : undefined

		const sdkHost = await VscodeSessionHost.create({
			mcpHub: this.options.mcpHub,
			requestToolApproval: this.options.requestToolApproval,
			askQuestion: this.options.askQuestion,
			toolPolicies,
			getTerminalManager: this.options.getTerminalManager,
			getRemoteConfigIntegration: this.options.getRemoteConfigIntegration,
		})
		const unsubscribe = sdkHost.subscribe(this.options.onSessionEvent)
		const startResult = await sdkHost.start(startInput)

		this.activeSession = {
			sessionId: startResult.sessionId,
			sdkHost,
			unsubscribe,
			startResult,
			isRunning: true,
		}

		return { startResult, sdkHost }
	}

	async replaceActiveSession(options: {
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
		if (!oldSession) {
			return undefined
		}

		const { sdkHost: oldManager, unsubscribe, sessionId: oldSessionId } = oldSession

		unsubscribe()
		oldManager.stop(oldSessionId).catch(() => {})
		oldManager.dispose(options.disposeReason).catch(() => {})

		const { startResult, sdkHost } = await this.startNewSession({
			...options.startInput,
			...(options.initialMessages ? { initialMessages: options.initialMessages } : {}),
		})
		this.setRunning(false)

		return { oldSessionId, startResult, sdkHost }
	}

	fireAndForgetSend(
		sdkHost: SdkSessionHost,
		sessionId: string,
		prompt: string,
		images?: string[],
		files?: string[],
		delivery?: "queue" | "steer",
	): void {
		sdkHost
			.send({
				sessionId,
				prompt,
				userImages: images,
				userFiles: files,
				delivery,
			})
			.then(async () => {
				if (delivery === "queue" || delivery === "steer") {
					Logger.log(`[SdkController] Message queued for session: ${sessionId}`)
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

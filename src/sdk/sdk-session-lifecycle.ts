import type { SessionHost, StartSessionResult } from "@clinebot/core"
import { Logger } from "@/shared/services/Logger"
import type { ActiveSession } from "./cline-session-factory"
import type { SdkSessionFactory } from "./sdk-session-factory"
import type { VscodeSessionHost } from "./vscode-session-host"

export interface SdkSessionLifecycleOptions {
	factory: SdkSessionFactory
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
	): Promise<{ startResult: StartSessionResult; sessionManager: SessionHost }> {
		const { startResult, sessionManager, unsubscribe } = await this.options.factory.createAndStartSession(startInput)

		this.activeSession = {
			sessionId: startResult.sessionId,
			sessionManager,
			unsubscribe,
			startResult,
			isRunning: true,
		}

		return { startResult, sessionManager }
	}

	async replaceActiveSession(options: {
		startInput: Parameters<VscodeSessionHost["start"]>[0]
		initialMessages?: Parameters<VscodeSessionHost["start"]>[0]["initialMessages"]
		disposeReason: string
	}): Promise<
		| {
				oldSessionId: string
				startResult: StartSessionResult
				sessionManager: SessionHost
		  }
		| undefined
	> {
		const oldSession = this.activeSession
		if (!oldSession) {
			return undefined
		}

		const { sessionManager: oldManager, unsubscribe, sessionId: oldSessionId } = oldSession

		unsubscribe()
		oldManager.stop(oldSessionId).catch(() => {})
		oldManager.dispose(options.disposeReason).catch(() => {})

		const { startResult, sessionManager } = await this.startNewSession({
			...options.startInput,
			...(options.initialMessages ? { initialMessages: options.initialMessages } : {}),
		})
		this.setRunning(false)

		return { oldSessionId, startResult, sessionManager }
	}

	fireAndForgetSend(
		sessionManager: SessionHost,
		sessionId: string,
		prompt: string,
		images?: string[],
		files?: string[],
		delivery?: "queue" | "steer",
	): void {
		sessionManager
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

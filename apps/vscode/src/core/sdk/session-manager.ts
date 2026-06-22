// Wraps a single ClineCore instance and the active session it owns. Mirrors the CLI's
// createCliCore + start/send/abort flow (apps/cli/src/runtime/run-agent.ts) and the deleted
// vscode-session-host. The Controller drives task lifecycle through this manager and consumes
// translated events via subscribe().

import {
	ClineCore,
	type CoreSessionConfig,
	type CoreSessionEvent,
	SessionSource,
} from "@cline/core"
import type { ToolApprovalRequest, ToolApprovalResult } from "@cline/shared"
import { Logger } from "@shared/services/Logger"

export interface SdkSessionManagerDeps {
	/** Called when the agent requests approval for a tool call. Resolves approved/denied. */
	requestToolApproval?: (request: ToolApprovalRequest) => Promise<ToolApprovalResult>
}

export interface StartTaskInput {
	config: CoreSessionConfig
	prompt: string
	images?: string[]
	files?: string[]
}

/**
 * Manages the lifecycle of one ClineCore + its active session. Construction is async (ClineCore
 * boots a runtime host), so use the static create() factory. The Controller creates this lazily
 * on first task so extension activation never blocks on it.
 */
export class SdkSessionManager {
	private core?: ClineCore
	private activeSessionId?: string
	private readonly deps: SdkSessionManagerDeps
	// The Controller subscribes before the core is lazily created (so it never misses the first
	// turn's events). We hold the listener and attach it as soon as the core exists.
	private listener?: (event: CoreSessionEvent) => void
	private coreUnsubscribe?: () => void

	private constructor(deps: SdkSessionManagerDeps) {
		this.deps = deps
	}

	static create(deps: SdkSessionManagerDeps): SdkSessionManager {
		return new SdkSessionManager(deps)
	}

	getSessionId(): string | undefined {
		return this.activeSessionId
	}

	hasActiveSession(): boolean {
		return this.activeSessionId !== undefined
	}

	/** Lazily boot the ClineCore runtime, wiring the tool-approval capability. */
	private async ensureCore(): Promise<ClineCore> {
		if (this.core) {
			return this.core
		}
		this.core = await ClineCore.create({
			backendMode: "local",
			capabilities: {
				requestToolApproval: this.deps.requestToolApproval,
			},
		})
		Logger.log("[SdkSessionManager] ClineCore created (local backend)")
		// Attach any listener registered before the core existed.
		if (this.listener) {
			this.coreUnsubscribe = this.core.subscribe(this.listener)
		}
		return this.core
	}

	/**
	 * Start a new session and immediately FIRE the first turn via send(). We create the session
	 * with interactive:true and no prompt so start() returns at once; the caller subscribes
	 * before this resolves and consumes the turn's events. Returns the new sessionId.
	 */
	async startTask(input: StartTaskInput): Promise<string> {
		const core = await this.ensureCore()
		const started = await core.start({
			source: SessionSource.VSCODE,
			config: input.config,
			prompt: undefined,
			interactive: true,
			userImages: input.images,
			userFiles: input.files,
		})
		this.activeSessionId = started.sessionId
		Logger.log(`[SdkSessionManager] Session started: ${started.sessionId}`)
		// Fire-and-forget the first turn — send() blocks until the turn completes, but events
		// stream live via subscribe(). The caller must not await this.
		this.fireAndForgetSend(started.sessionId, input.prompt, input.images, input.files)
		return started.sessionId
	}

	/** Send a continuation prompt to the active session (fire-and-forget). */
	send(prompt: string, images?: string[], files?: string[]): void {
		if (!this.activeSessionId) {
			Logger.warn("[SdkSessionManager] send() called with no active session")
			return
		}
		this.fireAndForgetSend(this.activeSessionId, prompt, images, files)
	}

	private fireAndForgetSend(sessionId: string, prompt: string, images?: string[], files?: string[]): void {
		const core = this.core
		if (!core) {
			return
		}
		core
			.send({
				sessionId,
				prompt,
				userImages: images && images.length > 0 ? images : undefined,
				userFiles: files && files.length > 0 ? files : undefined,
			})
			.catch((error) => {
				Logger.error("[SdkSessionManager] send() failed:", error)
			})
	}

	/** Abort the active in-flight turn. Bump the epoch (cancel fence) BEFORE calling this. */
	async abort(): Promise<void> {
		if (!this.core || !this.activeSessionId) {
			return
		}
		try {
			await this.core.abort(this.activeSessionId, new Error("Cancelled by user"))
		} catch (error) {
			if (error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))) {
				return
			}
			Logger.error("[SdkSessionManager] abort() failed:", error)
		}
	}

	/**
	 * Subscribe to session events. Safe to call before the core is created (lazy): the listener is
	 * stored and attached as soon as ensureCore() boots the runtime, so the first turn is never missed.
	 */
	subscribe(listener: (event: CoreSessionEvent) => void): () => void {
		this.listener = listener
		this.coreUnsubscribe?.()
		this.coreUnsubscribe = this.core ? this.core.subscribe(listener) : undefined
		return () => {
			if (this.listener === listener) {
				this.listener = undefined
			}
			this.coreUnsubscribe?.()
			this.coreUnsubscribe = undefined
		}
	}

	/** Stop the active session (keeps the core alive for the next task). */
	async stopActiveSession(): Promise<void> {
		if (this.core && this.activeSessionId) {
			try {
				await this.core.stop(this.activeSessionId)
			} catch (error) {
				Logger.error("[SdkSessionManager] stop() failed:", error)
			}
		}
		this.activeSessionId = undefined
	}

	/** Dispose the core and any active session. */
	async dispose(reason = "SdkSessionManager.dispose"): Promise<void> {
		const core = this.core
		this.core = undefined
		this.activeSessionId = undefined
		if (core) {
			await core.dispose(reason).catch((error) => Logger.error("[SdkSessionManager] dispose() failed:", error))
		}
	}
}

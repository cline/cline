// SDK-backed Controller.
//
// Runs the extension on the Cline SDK (@cline/core) exactly like apps/cli: it builds a provider
// config from the legacy ApiConfiguration, starts a task via ClineCore, translates the SDK's
// CoreSessionEvents into ClineMessage[], streams them to the webview, and handles
// askResponse/cancel/clear. It owns the single MessageIdMinter (ts/seq/epoch authority), the
// ExtensionStateStore, the SdkSessionManager, the MessageTranslator, and the WebviewBridge.
//
// Members the surviving gutted handlers reference (stateManager, task, accountService, …) are
// retained — loosely typed where their real backing services are out of scope for this layer —
// so the rest of the codebase keeps compiling. The SDK pieces are constructed lazily/safely so
// activation never throws.

import type { CoreSessionEvent } from "@cline/core"
import type { ToolApprovalRequest, ToolApprovalResult } from "@cline/shared"
import type { StreamingResponseHandler } from "@core/controller/grpc-handler"
import type { ApiConfiguration } from "@shared/api"
import type { ClineMessage, ExtensionState, TurnState } from "@shared/ExtensionMessage"
import type { State } from "@shared/proto/cline/state"
import type { ClineMessage as ProtoClineMessage } from "@shared/proto/cline/ui"
import { Logger } from "@shared/services/Logger"
import type { ClineExtensionContext } from "@/shared/cline"
import { AuthService } from "../sdk/auth-service"
import { MessageIdMinter } from "../sdk/message-id-minter"
import { buildToolApprovalAskMessage, MessageTranslator } from "../sdk/message-translator"
import { buildSessionConfig, type SessionMode } from "../sdk/session-config"
import { SdkSessionManager } from "../sdk/session-manager"
import { ExtensionStateStore } from "../sdk/state-store"
import { WebviewBridge } from "../sdk/webview-bridge"

interface PendingToolApproval {
	resolve: (result: ToolApprovalResult) => void
	toolName: string
}

export class Controller {
	readonly context: ClineExtensionContext

	// ---- SDK integration layer ----
	private readonly minter: MessageIdMinter
	private readonly stateStore: ExtensionStateStore
	private readonly translator: MessageTranslator
	private readonly bridge: WebviewBridge
	private sessionManager?: SdkSessionManager
	private unsubscribe?: () => void

	private clineMessages: ClineMessage[] = []
	private turnState?: TurnState

	// Tool-approval requests waiting on an askResponse from the webview.
	private pendingToolApprovals: PendingToolApproval[] = []

	// ---- Compatibility members referenced by surviving gutted handlers ----
	// These keep the rest of the codebase compiling; their real backing services are out of
	// scope for the SDK MVP. Loosely typed on purpose.
	readonly stateManager: any = createInertStateManager()
	task: any = undefined

	// Cline account authentication (sign-in/out + auth-status streaming). Shared singleton so all
	// webviews observe the same auth state and providers.json is the single token source of truth.
	readonly authService: AuthService = AuthService.getInstance()
	terminalManager: any = undefined
	workspaceManager: any = undefined
	backgroundCommandRunning?: boolean = false
	backgroundCommandTaskId?: string = undefined

	constructor(context: ClineExtensionContext) {
		this.context = context
		this.minter = new MessageIdMinter()
		this.translator = new MessageTranslator(this.minter)
		this.bridge = new WebviewBridge()
		this.stateStore = new ExtensionStateStore(context)

		// Restore any persisted Cline credentials in the background. When it resolves it pushes an
		// auth-status update + refreshes ExtensionState, flipping the webview to chat if signed in.
		void this.authService.restoreAuth().catch((error) => Logger.error("[Controller] restoreAuth failed:", error))
	}

	async dispose(): Promise<void> {
		this.unsubscribe?.()
		this.unsubscribe = undefined
		this.rejectPendingApprovals()
		this.bridge.clearPartialMessageStream()
		this.bridge.clearStateStream()
		if (this.sessionManager) {
			await this.sessionManager.dispose("Controller.dispose").catch(() => {})
		}
		this.sessionManager = undefined
	}

	// ---- state ----

	async getStateToPostToWebview(): Promise<ExtensionState> {
		// The webview gates the onboarding/login view on `welcomeViewCompleted`, which we map to
		// "is the user signed in to Cline". An unauthenticated user sees the Login view; a signed-in
		// user sees chat.
		return this.stateStore.buildExtensionState(this.clineMessages, this.turnState, {
			isAuthenticated: this.authService.isAuthenticated(),
		})
	}

	async postStateToWebview(): Promise<void> {
		const state = await this.getStateToPostToWebview()
		await this.bridge.pushState(state)
	}

	getClineMessages(): ClineMessage[] {
		return this.clineMessages
	}

	// ---- webview stream registration (called by subscribe handlers) ----

	setPartialMessageStream(stream: StreamingResponseHandler<ProtoClineMessage>): void {
		this.bridge.setPartialMessageStream(stream)
	}

	clearPartialMessageStream(): void {
		this.bridge.clearPartialMessageStream()
	}

	setStateStream(stream: StreamingResponseHandler<State>): void {
		this.bridge.setStateStream(stream)
	}

	clearStateStream(): void {
		this.bridge.clearStateStream()
	}

	// ---- task lifecycle ----

	/**
	 * Start a new task. Clears the previous transcript, bumps the epoch fence, builds the SDK
	 * session config from the stored ApiConfiguration, creates + starts the SDK session,
	 * subscribes to translate events into the transcript, and fires the prompt fire-and-forget.
	 */
	async initTask(text?: string, images?: string[], files?: string[]): Promise<void> {
		const prompt = text ?? ""

		// Reset transcript + fence for the new conversation.
		this.unsubscribe?.()
		this.unsubscribe = undefined
		this.rejectPendingApprovals()
		this.clineMessages = []
		this.minter.bumpEpoch()
		this.translator.reset()
		this.setTurnPhase("streaming")

		// Seed the transcript with the user's task message.
		this.appendAndPush([
			this.stamp({ ts: this.minter.nextTs(), type: "say", say: "task", text: prompt, images, files, partial: false }),
		])

		const cwd = this.resolveCwd()
		const mode = this.getSessionMode()
		const config = buildSessionConfig(this.stateStore.getApiConfiguration(), mode, cwd, cwd)

		try {
			const manager = this.ensureSessionManager()
			// Subscribe BEFORE starting so we never miss the first turn's events.
			this.unsubscribe = manager.subscribe((event) => this.handleSessionEvent(event))
			await manager.startTask({ config, prompt, images, files })
			await this.postStateToWebview()
		} catch (error) {
			Logger.error("[Controller] initTask failed:", error)
			this.emitError(error)
		}
	}

	/**
	 * Respond to a pending ask. If a tool approval is pending, yes/no resolves it; otherwise the
	 * text is sent as a continuation prompt (a new agent turn).
	 */
	async askResponse(responseType: string, text?: string, images?: string[], files?: string[]): Promise<void> {
		if (this.pendingToolApprovals.length > 0 && (responseType === "yesButtonClicked" || responseType === "noButtonClicked")) {
			const approved = responseType === "yesButtonClicked"
			const pending = this.pendingToolApprovals.shift()
			pending?.resolve({ approved, ...(approved ? {} : { reason: "Denied by user" }) })
			this.setTurnPhase("streaming")
			await this.postStateToWebview()
			return
		}

		// messageResponse (or any other) -> continuation prompt.
		const prompt = text ?? ""
		if (!prompt && (!images || images.length === 0) && (!files || files.length === 0)) {
			return
		}
		this.translator.reset()
		this.setTurnPhase("streaming")
		this.appendAndPush([
			this.stamp({
				ts: this.minter.nextTs(),
				type: "say",
				say: "user_feedback",
				text: prompt,
				images,
				files,
				partial: false,
			}),
		])
		this.sessionManager?.send(prompt, images, files)
		await this.postStateToWebview()
	}

	/** Cancel the active turn. Bumps the epoch fence SYNCHRONOUSLY before aborting. */
	async cancelTask(): Promise<void> {
		this.minter.bumpEpoch()
		this.setTurnPhase("resumable")
		this.rejectPendingApprovals()
		if (this.sessionManager) {
			await this.sessionManager.abort()
		}
		await this.postStateToWebview()
	}

	/** Clear the active task: stop the session and reset the transcript. */
	async clearTask(): Promise<void> {
		this.unsubscribe?.()
		this.unsubscribe = undefined
		this.rejectPendingApprovals()
		if (this.sessionManager) {
			await this.sessionManager.stopActiveSession().catch(() => {})
		}
		this.clineMessages = []
		this.minter.bumpEpoch()
		this.translator.reset()
		this.setTurnPhase("idle")
		await this.postStateToWebview()
	}

	// ---- provider / config ----

	getApiConfiguration(): ApiConfiguration {
		return this.stateStore.getApiConfiguration()
	}

	async updateApiConfiguration(config: Partial<ApiConfiguration>): Promise<void> {
		this.stateStore.setApiConfiguration(config)
		await this.postStateToWebview()
	}

	// ---- internals ----

	private ensureSessionManager(): SdkSessionManager {
		if (!this.sessionManager) {
			this.sessionManager = SdkSessionManager.create({
				requestToolApproval: (request) => this.handleRequestToolApproval(request),
			})
		}
		return this.sessionManager
	}

	/** Translate an SDK session event and stream the resulting messages + state to the webview. */
	private handleSessionEvent(event: CoreSessionEvent): void {
		try {
			const messages = this.translator.translate(event)
			if (messages.length > 0) {
				this.appendAndPush(messages)
			}
			if (this.isTurnTerminal(event)) {
				this.setTurnPhase(this.terminalPhaseFor(event))
				this.postStateToWebview().catch((error) => Logger.error("[Controller] post state after turn failed:", error))
			}
		} catch (error) {
			Logger.error("[Controller] handleSessionEvent failed:", error)
		}
	}

	/** Service a tool-approval request: emit an ask row + park a resolver for askResponse. */
	private handleRequestToolApproval(request: ToolApprovalRequest): Promise<ToolApprovalResult> {
		const { ask, text } = buildToolApprovalAskMessage(request.toolName, request.input)
		const ts = this.minter.nextTs()
		this.appendAndPush([this.stamp({ ts, type: "ask", ask, text, partial: false })])
		this.setTurnPhase("awaiting_approval", ts)
		this.postStateToWebview().catch(() => {})
		return new Promise<ToolApprovalResult>((resolve) => {
			this.pendingToolApprovals.push({ resolve, toolName: request.toolName })
		})
	}

	private rejectPendingApprovals(): void {
		const pending = this.pendingToolApprovals
		this.pendingToolApprovals = []
		for (const item of pending) {
			item.resolve({ approved: false, reason: "Cancelled" })
		}
	}

	private appendAndPush(messages: ClineMessage[]): void {
		for (const message of messages) {
			const index = this.clineMessages.findIndex((m) => m.ts === message.ts)
			if (index >= 0) {
				this.clineMessages[index] = message
			} else {
				this.clineMessages.push(message)
			}
			this.bridge.pushMessage(message).catch((error) => Logger.error("[Controller] pushMessage failed:", error))
		}
	}

	private emitError(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error)
		this.setTurnPhase("error")
		this.appendAndPush([this.stamp({ ts: this.minter.nextTs(), type: "say", say: "error", text: message, partial: false })])
		this.postStateToWebview().catch(() => {})
	}

	private stamp(message: ClineMessage): ClineMessage {
		message.seq = this.minter.nextSeq()
		message.epoch = this.minter.currentEpoch()
		return message
	}

	private setTurnPhase(phase: TurnState["phase"], anchorTs?: number): void {
		this.turnState = { phase, anchorTs, seq: this.minter.nextSeq() }
	}

	private getSessionMode(): SessionMode {
		return this.stateStore.getMode() === "plan" ? "plan" : "act"
	}

	private isTurnTerminal(event: CoreSessionEvent): boolean {
		if (event.type === "ended") {
			return true
		}
		if (event.type === "agent_event") {
			const t = event.payload.event.type
			return t === "done" || t === "error"
		}
		return false
	}

	private terminalPhaseFor(event: CoreSessionEvent): TurnState["phase"] {
		if (event.type === "agent_event" && event.payload.event.type === "error") {
			return "error"
		}
		// Without deeper completion-tool tracking, a finished turn awaits the user's next input.
		return "awaiting_followup"
	}

	private resolveCwd(): string {
		try {
			return process.cwd()
		} catch {
			return "."
		}
	}
}

function createInertStateManager(): any {
	return {
		getApiConfiguration: () => ({}),
		getGlobalStateKey: (_key: string) => undefined,
		getGlobalSettingsKey: (_key: string) => undefined,
		getSecretKey: (_key: string) => undefined,
		setGlobalState: (_key: string, _value: unknown) => {},
		setGlobalStateBatch: (_values: unknown) => {},
		setSecretsBatch: (_values: unknown) => {},
		setApiConfiguration: (_config: unknown) => {},
		setTaskSettings: (_settings: unknown) => {},
		setTaskSettingsBatch: (_settings: unknown) => {},
		flushPendingState: async () => {},
	}
}

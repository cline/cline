// CloudSessionHost — an SdkSessionHost backed by a Cline Cloud sandbox.
//
// A cloud session has two ids: the outer `ses-…` record owned by the Cline
// Cloud control plane (what extension history and the task view use as their
// identifier), and the canonical `tsk-…` Hub session named by the control plane. This host dials the
// pod's Hub through the api.cline.bot WebSocket proxy with the user's Cline
// account token, maps outer <-> inner ids, and re-emits Hub events under the
// outer id so the rest of the extension (session lifecycle, event coordinator,
// message translator, chat view) works exactly as it does for local sessions.
//
// No local tool executors are attached: editing, commands and file reads all
// run inside the sandbox. Tools are auto-approved there (the sandbox is
// isolated and the session must keep going after VS Code closes), so the
// approval capability only surfaces anything the pod still insists on asking.

import {
	type CompareCheckpointInput,
	type CompareCheckpointResult,
	type CoreSessionEvent,
	type HookEventPayload,
	type ITelemetryService,
	type PendingPromptMutationResult,
	type PendingPromptsDeleteInput,
	type PendingPromptsListInput,
	type PendingPromptsUpdateInput,
	RemoteRuntimeHost,
	type RestoreInput,
	type RestoreResult,
	type SendSessionInput,
	type SessionAccumulatedUsage,
	type SessionCompactionState,
	type SessionHistoryRecord,
	type SessionPendingPrompt,
	type SessionRecord,
	type StartSessionInput,
	type StartSessionResult,
} from "@cline/core"
import type { AgentResult, ToolApprovalRequest, ToolApprovalResult } from "@cline/shared"
import { CLOUD_SESSION_MODE, CLOUD_WORKSPACE_ROOT, type CloudSessionStatus } from "@shared/cloud/cloud-sessions"
import { Logger } from "@/shared/services/Logger"
import type { SdkInitialMessages, SdkSessionHost } from "./session-host"

export const CLOUD_GITHUB_AUTH_SYSTEM_PROMPT =
	"IMPORTANT: GitHub API authentication is handled automatically by the infrastructure. " +
	"A secrets-proxy sidecar injects the necessary authentication credentials into all GitHub API requests. " +
	"You do NOT need to set up, configure, or manage any authentication tokens, API keys, or credentials for GitHub API calls. " +
	"Simply make your GitHub API calls normally — authentication will be injected transparently."

export interface CloudSessionHostOptions {
	outerSessionId: string
	/** Canonical `tsk-…` id shared by runtime requests, transcripts and history snapshots. */
	taskId: string
	socketUrl: string
	getAuthToken: () => Promise<string | null | undefined>
	requestToolApproval?: (request: ToolApprovalRequest) => Promise<ToolApprovalResult>
	telemetry?: ITelemetryService
	onStatusChange?: (status: CloudSessionStatus) => void
	/** Sandbox workspace root. Hosted sandboxes use /workspace. */
	workspaceRoot?: string
}

export function mapAgentStatus(status: string): CloudSessionStatus | undefined {
	switch (status) {
		case "running":
		case "pending":
			return "running"
		case "completed":
			return "completed"
		case "failed":
		case "error":
			return "failed"
		case "idle":
			return "idle"
		case "cancelled":
		case "aborted":
			return "cancelled"
		default:
			return undefined
	}
}

export function mapAgentFinishReason(reason: AgentResult["finishReason"] | string): CloudSessionStatus {
	switch (reason) {
		case "completed":
			return "completed"
		case "aborted":
			return "cancelled"
		case "error":
		case "max_iterations":
		case "mistake_limit":
			return "failed"
		default:
			return "unknown"
	}
}

function unsupported(operation: string): never {
	throw new Error(`${operation} is not supported for cloud sessions`)
}

export class CloudSessionHost implements SdkSessionHost {
	readonly isCloud = true as const
	readonly runtimeAddress: string | undefined
	readonly outerSessionId: string
	private readonly taskId: string
	private innerSessionId: string | undefined
	private agentStatus: CloudSessionStatus = "idle"
	private modelId: string | undefined
	private readonly host: RemoteRuntimeHost
	private readonly statusUnsubscribe: () => void
	private disposed = false

	private constructor(
		private readonly options: CloudSessionHostOptions,
		host: RemoteRuntimeHost,
	) {
		this.outerSessionId = options.outerSessionId
		this.taskId = options.taskId
		this.host = host
		this.runtimeAddress = options.socketUrl
		// Track the agent's activity for the whole life of the connection, not
		// just while a task view is subscribed: the registry uses it to show
		// running/finished in History and to notify when a background cloud
		// task completes.
		this.statusUnsubscribe = host.subscribe((event) => this.trackStatus(event))
	}

	static async connect(options: CloudSessionHostOptions): Promise<CloudSessionHost> {
		const workspaceRoot = options.workspaceRoot ?? CLOUD_WORKSPACE_ROOT
		const host = new RemoteRuntimeHost({
			endpoint: options.socketUrl,
			clientType: "vscode-cloud-session",
			displayName: "Cline for VS Code (cloud session)",
			workspaceRoot,
			cwd: workspaceRoot,
			telemetry: options.telemetry,
			capabilities: options.requestToolApproval ? { requestToolApproval: options.requestToolApproval } : undefined,
			resolveConnectionHeaders: async () => {
				const token = (await options.getAuthToken())?.trim()
				if (!token) {
					throw new Error("Sign in to Cline to connect to this cloud session.")
				}
				return { Authorization: `Bearer ${token}` }
			},
		})
		await host.connect()
		const cloudHost = new CloudSessionHost(options, host)
		await cloudHost.discoverInnerSession()
		return cloudHost
	}

	get sessionId(): string {
		return this.outerSessionId
	}

	get status(): CloudSessionStatus {
		return this.agentStatus
	}

	get hasInnerSession(): boolean {
		return !!this.innerSessionId
	}

	get sessionModelId(): string | undefined {
		return this.modelId
	}

	/** Attach only to the canonical conversation named by the control plane. */
	private async discoverInnerSession(): Promise<void> {
		const sessions = await this.host.listSessions(100)
		const task = sessions.find((session) => session.sessionId === this.taskId)
		if (task) {
			this.innerSessionId = task.sessionId
			this.modelId = typeof task.model === "string" ? task.model : undefined
			const mapped = mapAgentStatus(String(task.status ?? ""))
			if (mapped) {
				this.setStatus(mapped)
			}
		}
	}

	private trackStatus(event: CoreSessionEvent): void {
		if (!this.innerSessionId || event.payload.sessionId !== this.innerSessionId) {
			return
		}
		if (event.type === "status") {
			const mapped = mapAgentStatus(event.payload.status)
			// "idle" is the resting state after any turn; keep the more specific
			// completed/failed/cancelled outcome until the agent runs again.
			if (mapped && !(mapped === "idle" && ["completed", "failed", "cancelled"].includes(this.agentStatus))) {
				this.setStatus(mapped)
			}
		} else if (event.type === "ended") {
			this.setStatus(mapAgentFinishReason(event.payload.reason))
		} else if (event.type === "agent_event") {
			const agentEvent = event.payload.event
			if (agentEvent.type === "done") {
				this.setStatus(mapAgentFinishReason(agentEvent.reason))
			} else if (agentEvent.type === "error" && agentEvent.recoverable === false) {
				this.setStatus("failed")
			} else if (this.agentStatus !== "running") {
				this.setStatus("running")
			}
		} else if (event.type === "chunk" && this.agentStatus !== "running") {
			this.setStatus("running")
		}
	}

	private setStatus(status: CloudSessionStatus): void {
		if (this.agentStatus === status) {
			return
		}
		this.agentStatus = status
		this.options.onStatusChange?.(status)
	}

	private toInner(sessionId: string): string {
		if (sessionId !== this.outerSessionId && sessionId !== this.innerSessionId) {
			Logger.warn(`[CloudSessionHost] Unexpected session id ${sessionId} for cloud session ${this.outerSessionId}`)
		}
		if (!this.innerSessionId) {
			throw new Error("This cloud session has no conversation yet.")
		}
		return this.innerSessionId
	}

	private remap(event: CoreSessionEvent): CoreSessionEvent | undefined {
		if (!this.innerSessionId || event.payload.sessionId !== this.innerSessionId) {
			return undefined
		}
		return { ...event, payload: { ...event.payload, sessionId: this.outerSessionId } } as CoreSessionEvent
	}

	// ---- SdkSessionHost ----

	async start(input: StartSessionInput): Promise<StartSessionResult> {
		if (this.innerSessionId) {
			throw new Error("This cloud session already has a conversation.")
		}
		const workspaceRoot = this.options.workspaceRoot ?? CLOUD_WORKSPACE_ROOT
		const cwd = input.config.cwd?.trim() || workspaceRoot
		// The control plane snapshots the outer session and canonical task ids
		// together. Keep that task id for every artifact this Hub session writes.
		const plannedId = this.taskId
		this.innerSessionId = plannedId
		this.setStatus("running")
		try {
			const result = await this.host.startSession({
				...input,
				config: {
					...input.config,
					sessionId: plannedId,
					cwd,
					workspaceRoot,
					systemPrompt: input.config.systemPrompt
						? `${CLOUD_GITHUB_AUTH_SYSTEM_PROMPT}\n\n${input.config.systemPrompt}`
						: CLOUD_GITHUB_AUTH_SYSTEM_PROMPT,
				},
				toolPolicies: { "*": { enabled: true, autoApprove: true } },
			})
			this.innerSessionId = result.sessionId
			this.modelId = input.config.modelId
			return { ...result, sessionId: this.outerSessionId }
		} catch (error) {
			this.innerSessionId = undefined
			this.setStatus("failed")
			throw error
		}
	}

	async send(input: SendSessionInput): Promise<AgentResult | undefined> {
		const sessionId = this.toInner(input.sessionId)
		this.setStatus("running")
		try {
			return await this.host.runTurn({
				...input,
				sessionId,
				// The sandbox runtime was built for Act; every turn must say the same.
				mode: CLOUD_SESSION_MODE,
				// Local file paths mean nothing inside the sandbox; images travel as data URLs.
				userFiles: undefined,
			})
		} catch (error) {
			// A rejected RPC proves only that this client stopped observing the turn;
			// the sandbox may still be running after a transport loss.
			if (!this.disposed && (this.agentStatus === "running" || this.agentStatus === "idle")) {
				this.setStatus("unknown")
			}
			throw error
		}
	}

	async getAccumulatedUsage(sessionId: string): Promise<SessionAccumulatedUsage | undefined> {
		const summary = await this.host.getAccumulatedUsage?.(this.toInner(sessionId))
		return summary?.usage
	}

	async abort(sessionId: string, reason?: unknown): Promise<void> {
		try {
			await this.host.abort(this.toInner(sessionId), reason)
		} catch (error) {
			if (error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))) {
				return
			}
			throw error
		}
	}

	/**
	 * "Stopping" a cloud session from the task view must not stop the agent:
	 * the whole point is that it keeps running after the user moves on. The
	 * connection is kept by the registry; the caller only unsubscribes.
	 */
	async stop(_sessionId: string): Promise<void> {}

	async dispose(_reason?: string): Promise<void> {
		if (this.disposed) {
			return
		}
		this.disposed = true
		this.statusUnsubscribe()
		await this.host.dispose()
	}

	async get(sessionId: string): Promise<SessionRecord | undefined> {
		if (!this.innerSessionId) {
			return undefined
		}
		const record = await this.host.getSession(this.toInner(sessionId))
		return record ? { ...record, sessionId: this.outerSessionId } : undefined
	}

	async list(): Promise<SessionHistoryRecord[]> {
		return []
	}

	async listHistory(): Promise<SessionHistoryRecord[]> {
		return []
	}

	async delete(_sessionId: string): Promise<boolean> {
		return unsupported("Deleting the sandbox conversation")
	}

	async readMessages(sessionId: string): Promise<SdkInitialMessages> {
		if (!this.innerSessionId) {
			return []
		}
		return (await this.host.readSessionMessages(this.toInner(sessionId))) as SdkInitialMessages
	}

	async readLiveMessages(sessionId: string): Promise<SdkInitialMessages> {
		return this.readMessages(sessionId)
	}

	async updateSessionCompactionState(sessionId: string, state: SessionCompactionState): Promise<{ updated: boolean }> {
		return this.host.updateSessionCompactionState(this.toInner(sessionId), state)
	}

	async restore(_input: RestoreInput): Promise<RestoreResult> {
		return unsupported("Checkpoint restore")
	}

	async compareCheckpoint(_input: CompareCheckpointInput): Promise<CompareCheckpointResult> {
		return unsupported("Checkpoint comparison")
	}

	async update(
		sessionId: string,
		updates: { prompt?: string | null; metadata?: Record<string, unknown> | null; title?: string | null },
	): Promise<{ updated: boolean }> {
		if (!this.innerSessionId) {
			return { updated: false }
		}
		return this.host.updateSession(this.toInner(sessionId), updates)
	}

	async handleHookEvent(payload: HookEventPayload): Promise<void> {
		return this.host.dispatchHookEvent(payload)
	}

	pendingPrompts(action: "list", input: PendingPromptsListInput): Promise<SessionPendingPrompt[]>
	pendingPrompts(action: "update", input: PendingPromptsUpdateInput): Promise<PendingPromptMutationResult>
	pendingPrompts(action: "delete", input: PendingPromptsDeleteInput): Promise<PendingPromptMutationResult>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async pendingPrompts(action: any, input: any): Promise<any> {
		const mapped = { ...input, sessionId: this.toInner(input.sessionId) }
		switch (action) {
			case "list":
				return await this.host.pendingPrompts.list(mapped)
			case "update":
				return { ...(await this.host.pendingPrompts.update(mapped)), sessionId: this.outerSessionId }
			case "delete":
				return { ...(await this.host.pendingPrompts.delete(mapped)), sessionId: this.outerSessionId }
			default:
				throw new Error(`Unsupported pending prompt action: ${String(action)}`)
		}
	}

	subscribe(listener: (event: CoreSessionEvent) => void): () => void {
		return this.host.subscribe((event) => {
			const remapped = this.remap(event)
			if (remapped) {
				listener(remapped)
			}
		})
	}

	async updateSessionModel(sessionId: string, modelId: string): Promise<void> {
		const service = this.host as { updateSessionModel?: (sessionId: string, modelId: string) => Promise<void> }
		await service.updateSessionModel?.(this.toInner(sessionId), modelId)
		this.modelId = modelId
	}
}

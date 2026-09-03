// CloudSessionHost — an SdkSessionHost backed by a Cline Cloud sandbox.
//
// A cloud session has two ids: the outer `ses-…` record owned by the Cline
// Cloud control plane (what history and the task view use as the task id),
// and the inner Hub session running on the sandbox pod. This host dials the
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
import { CLOUD_WORKSPACE_ROOT, type CloudSessionStatus } from "@shared/cloud/cloud-sessions"
import { Logger } from "@/shared/services/Logger"
import type { SdkInitialMessages, SdkSessionHost } from "./session-host"

export const CLOUD_GITHUB_AUTH_SYSTEM_PROMPT =
	"IMPORTANT: GitHub API authentication is handled automatically by the infrastructure. " +
	"A secrets-proxy sidecar injects the necessary authentication credentials into all GitHub API requests. " +
	"You do NOT need to set up, configure, or manage any authentication tokens, API keys, or credentials for GitHub API calls. " +
	"Simply make your GitHub API calls normally — authentication will be injected transparently."

export interface CloudSessionHostOptions {
	outerSessionId: string
	socketUrl: string
	getAuthToken: () => Promise<string | null | undefined>
	requestToolApproval?: (request: ToolApprovalRequest) => Promise<ToolApprovalResult>
	telemetry?: ITelemetryService
	onStatusChange?: (status: CloudSessionStatus) => void
	/** Plan/Act mode for the next turn; the sandbox takes the mode per turn instead of by session rebuild. */
	getMode?: () => "plan" | "act"
}

function mapAgentStatus(status: string): CloudSessionStatus | undefined {
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
		case "cancelled":
		case "aborted":
			return "idle"
		default:
			return undefined
	}
}

function unsupported(operation: string): never {
	throw new Error(`${operation} is not supported for cloud sessions`)
}

export class CloudSessionHost implements SdkSessionHost {
	readonly isCloud = true as const
	readonly runtimeAddress: string | undefined
	readonly outerSessionId: string
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
		this.host = host
		this.runtimeAddress = options.socketUrl
		// Track the agent's activity for the whole life of the connection, not
		// just while a task view is subscribed: the registry uses it to show
		// running/finished in History and to notify when a background cloud
		// task completes.
		this.statusUnsubscribe = host.subscribe((event) => this.trackStatus(event))
	}

	static async connect(options: CloudSessionHostOptions): Promise<CloudSessionHost> {
		const host = new RemoteRuntimeHost({
			endpoint: options.socketUrl,
			clientType: "vscode-cloud-session",
			displayName: "Cline for VS Code (cloud session)",
			workspaceRoot: CLOUD_WORKSPACE_ROOT,
			cwd: CLOUD_WORKSPACE_ROOT,
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

	/** The sandbox Hub hosts at most one conversation per sandbox; adopt the newest. */
	private async discoverInnerSession(): Promise<void> {
		const sessions = await this.host.listSessions(100)
		const newest = [...sessions].sort(
			(a, b) => Date.parse(String(b.updatedAt ?? "")) - Date.parse(String(a.updatedAt ?? "")),
		)[0]
		if (newest?.sessionId) {
			this.innerSessionId = newest.sessionId
			this.modelId = typeof newest.model === "string" ? newest.model : undefined
			const mapped = mapAgentStatus(String(newest.status ?? ""))
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
			if (mapped) {
				this.setStatus(mapped)
			}
		} else if (event.type === "ended") {
			this.setStatus("completed")
		} else if (event.type === "agent_event" || event.type === "chunk") {
			if (this.agentStatus !== "running") {
				this.setStatus("running")
			}
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
		const cwd = input.config.cwd?.trim() || CLOUD_WORKSPACE_ROOT
		// Pin the inner id to the outer id so events need no remapping for
		// sessions this extension created; attached sessions created elsewhere
		// keep their own inner id.
		const plannedId = this.outerSessionId
		this.innerSessionId = plannedId
		this.setStatus("running")
		try {
			const result = await this.host.startSession({
				...input,
				config: {
					...input.config,
					sessionId: plannedId,
					cwd,
					workspaceRoot: CLOUD_WORKSPACE_ROOT,
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
		this.setStatus("running")
		return this.host.runTurn({
			...input,
			sessionId: this.toInner(input.sessionId),
			mode: input.mode ?? this.options.getMode?.(),
			// Local file paths mean nothing inside the sandbox; images travel as data URLs.
			userFiles: undefined,
		})
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
	pendingPrompts(action: any, input: any): any {
		const mapped = { ...input, sessionId: this.toInner(input.sessionId) }
		switch (action) {
			case "list":
				return this.host.pendingPrompts.list(mapped)
			case "update":
				return this.host.pendingPrompts.update(mapped)
			case "delete":
				return this.host.pendingPrompts.delete(mapped)
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

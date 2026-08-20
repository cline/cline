import type {
	ClineCoreListHistoryOptions,
	ClineCoreStartInput,
	CompareCheckpointInput,
	CompareCheckpointResult,
	CoreSessionEvent,
	HookEventPayload,
	MonitorRecord,
	PendingPromptMutationResult,
	PendingPromptsDeleteInput,
	PendingPromptsListInput,
	PendingPromptsUpdateInput,
	RestoreInput,
	RestoreResult,
	SendSessionInput,
	SessionAccumulatedUsage,
	SessionCompactionState,
	SessionHistoryRecord,
	SessionPendingPrompt,
	SessionRecord,
	StartSessionInput,
	StartSessionResult,
} from "@cline/core"
import type { AgentResult } from "@cline/shared"

export interface SdkSessionHost {
	readonly runtimeAddress: string | undefined
	start(input: StartSessionInput): Promise<StartSessionResult>
	start(input: ClineCoreStartInput): Promise<StartSessionResult>
	send(input: SendSessionInput): Promise<AgentResult | undefined>
	getAccumulatedUsage(sessionId: string): Promise<SessionAccumulatedUsage | undefined>
	abort(sessionId: string, reason?: unknown): Promise<void>
	stop(sessionId: string): Promise<void>
	dispose(reason?: string): Promise<void>
	get(sessionId: string): Promise<SessionRecord | undefined>
	list(limit?: number, options?: Omit<ClineCoreListHistoryOptions, "limit">): Promise<SessionHistoryRecord[]>
	listHistory(options?: ClineCoreListHistoryOptions): Promise<SessionHistoryRecord[]>
	delete(sessionId: string): Promise<boolean>
	readMessages(sessionId: string): Promise<SdkInitialMessages>
	/**
	 * Like readMessages, but prefers the live in-memory conversation when the
	 * session is still resident, so an in-flight (or just-aborted) turn is not
	 * lost to the persisted transcript lagging behind.
	 */
	readLiveMessages?(sessionId: string): Promise<SdkInitialMessages>
	updateSessionCompactionState?(sessionId: string, state: SessionCompactionState): Promise<{ updated: boolean }>
	restore(input: RestoreInput): Promise<RestoreResult>
	/** Diffs a checkpoint snapshot against the current working tree. */
	compareCheckpoint?(input: CompareCheckpointInput): Promise<CompareCheckpointResult>
	update(
		sessionId: string,
		updates: {
			prompt?: string | null
			metadata?: Record<string, unknown> | null
			title?: string | null
		},
	): Promise<{ updated: boolean }>
	handleHookEvent(payload: HookEventPayload): Promise<void>
	pendingPrompts(action: "list", input: PendingPromptsListInput): Promise<SessionPendingPrompt[]>
	pendingPrompts(action: "update", input: PendingPromptsUpdateInput): Promise<PendingPromptMutationResult>
	pendingPrompts(action: "delete", input: PendingPromptsDeleteInput): Promise<PendingPromptMutationResult>
	/** Current roster of the session's background monitors. */
	listMonitors(sessionId: string): Promise<MonitorRecord[]>
	/** Stops one background monitor on the user's behalf, without a model turn. */
	stopMonitor(sessionId: string, monitorId: string): Promise<boolean>
	subscribe(listener: (event: CoreSessionEvent) => void): () => void
	updateSessionModel?(sessionId: string, modelId: string): Promise<void>
}

export type SdkInitialMessages = NonNullable<StartSessionInput["initialMessages"]>

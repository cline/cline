import type {
	ClineCoreListHistoryOptions,
	ClineCoreStartInput,
	CoreSessionEvent,
	HookEventPayload,
	PendingPromptMutationResult,
	PendingPromptsDeleteInput,
	PendingPromptsListInput,
	PendingPromptsUpdateInput,
	SendSessionInput,
	SessionAccumulatedUsage,
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
	subscribe(listener: (event: CoreSessionEvent) => void): () => void
	updateSessionModel?(sessionId: string, modelId: string): Promise<void>
}

export type SdkInitialMessages = NonNullable<StartSessionInput["initialMessages"]>

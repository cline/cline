import type {
	BedrockCoderCoreListHistoryOptions,
	BedrockCoderCoreStartInput,
	CoreSessionEvent,
	HookEventPayload,
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
} from "@bedrock-coder/core"
import type {
	AgentResult,
	CreateTeamTaskInput,
	TeamBoardSnapshot,
	TeamRunRecord,
	TeamTask,
	UpdateTeamTaskInput,
} from "@bedrock-coder/shared"

export interface SdkSessionHost {
	readonly runtimeAddress: string | undefined
	start(input: StartSessionInput): Promise<StartSessionResult>
	start(input: BedrockCoderCoreStartInput): Promise<StartSessionResult>
	send(input: SendSessionInput): Promise<AgentResult | undefined>
	getAccumulatedUsage(sessionId: string): Promise<SessionAccumulatedUsage | undefined>
	abort(sessionId: string, reason?: unknown): Promise<void>
	stop(sessionId: string): Promise<void>
	dispose(reason?: string): Promise<void>
	get(sessionId: string): Promise<SessionRecord | undefined>
	list(limit?: number, options?: Omit<BedrockCoderCoreListHistoryOptions, "limit">): Promise<SessionHistoryRecord[]>
	listHistory(options?: BedrockCoderCoreListHistoryOptions): Promise<SessionHistoryRecord[]>
	delete(sessionId: string): Promise<boolean>
	readMessages(sessionId: string): Promise<SdkInitialMessages>
	updateSessionCompactionState?(sessionId: string, state: SessionCompactionState): Promise<{ updated: boolean }>
	restore(input: RestoreInput): Promise<RestoreResult>
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
	getTeamBoard?(sessionId: string): TeamBoardSnapshot | undefined
	createTeamTask?(sessionId: string, input: Omit<CreateTeamTaskInput, "createdBy">): TeamTask
	updateTeamTask?(sessionId: string, input: UpdateTeamTaskInput): TeamTask
	cancelTeamRun?(sessionId: string, runId: string, reason?: string): TeamRunRecord
}

export type SdkInitialMessages = NonNullable<StartSessionInput["initialMessages"]>

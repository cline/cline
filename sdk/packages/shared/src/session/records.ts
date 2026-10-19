export const SESSION_STATUS_VALUES = [
	// The session is available for input and no turn is executing. Use both for
	// a newly created session waiting for its first prompt and after a turn
	// completes; an idle session with no prompt/messages is effectively new.
	"idle",
	// A turn is actively executing. Use from first prompt dispatch until the
	// runtime emits a terminal result or cancellation.
	"running",
	// Work is waiting to be delivered or resumed, but is not currently executing.
	// Use for queued prompts or runtime handoff; transition to running when work
	// begins, or to a terminal state when it is discarded.
	"pending",
	// The session reached a normal terminal result. Use with endedAt/exitCode
	// metadata when the runtime will not accept another turn.
	"completed",
	// The session terminated because of an execution or setup failure. Use when
	// the failure is not a user cancellation and preserve diagnostic metadata.
	"failed",
	// The session was intentionally stopped or aborted by the user/system. Use
	// instead of failed for expected interruption and record the exit reason.
	"cancelled",
] as const;

export type SharedSessionStatus = (typeof SESSION_STATUS_VALUES)[number];

export interface SessionLineage {
	parentSessionId?: string;
	agentId?: string;
	parentAgentId?: string;
	conversationId?: string;
	isSubagent: boolean;
}

export interface SessionRuntimeRecordShape extends SessionLineage {
	source: string;
	pid?: number;
	startedAt: string;
	endedAt?: string | null;
	exitCode?: number | null;
	status: SharedSessionStatus;
	interactive: boolean;
	provider: string;
	model: string;
	cwd: string;
	workspaceRoot: string;
	teamName?: string;
	enableTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	prompt?: string;
	metadata?: Record<string, unknown>;
	hookPath?: string;
	messagesPath?: string;
	updatedAt: string;
}

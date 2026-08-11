import type {
	AgentFinishReason,
	SessionLineage,
	SessionRuntimeRecordShape,
} from "@cline/shared";
import type { SessionSource, SessionStatus } from "./common";

export interface SessionUsageMetadata {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalCost: number;
}

export interface SessionRef extends SessionLineage {
	sessionId: string;
}

export interface SessionRecord
	extends SessionRef,
		Omit<SessionRuntimeRecordShape, "source" | "status"> {
	source: SessionSource;
	status: SessionStatus;
}

/**
 * Outcome of the most recent agent turn that ended, written by the runtime
 * when the turn finishes. Lets clients tell that the agent is done (vs merely
 * idle between turns) without inspecting the transcript.
 */
export interface SessionTurnCompletionMetadata {
	finishReason: AgentFinishReason;
	/** ISO 8601 timestamp of when the turn ended. */
	endedAt: string;
}

export interface SessionHistoryMetadata extends Record<string, unknown> {
	title?: string;
	lastTurnCompletion?: SessionTurnCompletionMetadata;
	/**
	 * True when the agent finished a turn on its own and no human has seen
	 * the result yet. Set by the runtime at turn end (skipped for user
	 * aborts, since someone was present to stop the turn) and cleared when
	 * the next turn starts. Clients should clear it (write `null`/omit the
	 * key) when the user views the session, so "needs review" indicators
	 * stay consistent across every client reading the session.
	 */
	needsAttention?: boolean;
	git?: {
		url?: string;
		branch?: string;
	};
	totalCost?: number;
	aggregatedAgentsCost?: number;
	usage?: SessionUsageMetadata;
	aggregateUsage?: SessionUsageMetadata;
	checkpoint?: {
		latest?: {
			ref?: string;
			createdAt?: number;
			runCount?: number;
		};
		history?: Array<{
			ref?: string;
			createdAt?: number;
			runCount?: number;
		}>;
	};
}

export interface SessionHistoryRecord extends Omit<SessionRecord, "metadata"> {
	metadata?: SessionHistoryMetadata;
}

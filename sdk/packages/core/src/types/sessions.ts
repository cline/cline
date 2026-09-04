import type {
	ReasoningEffortValue,
	SessionLineage,
	SessionRuntimeRecordShape,
} from "@cline/shared";
import type { SessionSource, SessionStatus } from "./common";

/**
 * The thinking/reasoning level a session actually runs with, persisted so
 * history and resume report the level the user picked instead of re-deriving
 * it from whatever the global provider settings happen to say later.
 *
 * `enabled: false` records an explicit "no thinking" choice; the key being
 * absent entirely means the session predates this metadata.
 */
export interface SessionThinkingMetadata {
	enabled: boolean;
	/** Undefined when thinking is on but the level is left to the provider. */
	level?: ReasoningEffortValue;
	budgetTokens?: number;
}

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

export interface SessionHistoryMetadata extends Record<string, unknown> {
	title?: string;
	git?: {
		url?: string;
		branch?: string;
	};
	thinking?: SessionThinkingMetadata;
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

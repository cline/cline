import type { SessionLineage, SessionRuntimeRecordShape } from "@cline/shared";
import type { SessionSource, SessionStatus } from "./common";

export const SESSION_HISTORY_SCHEMA_VERSION = 2;

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
	schemaVersion?: typeof SESSION_HISTORY_SCHEMA_VERSION;
	title?: string;
	mode?: "plan" | "act";
	outcome?: "completed" | "failed" | "cancelled" | "interrupted";
	workspace?: {
		root?: string;
		repositoryRoot?: string;
		repositoryUrl?: string;
	};
	bedrockTarget?: {
		kind?: "foundation-model" | "inference-profile";
		invocationId: string;
		arn?: string;
		baseModelId?: string;
		region?: string;
	};
	team?: {
		teamTaskId?: string;
		agentId?: string;
		parentSessionId?: string;
		worktreePath?: string;
		branch?: string;
	};
	recoveryIssue?: {
		category:
			| "corrupt"
			| "interrupted-run"
			| "missing-workspace"
			| "missing-worktree"
			| "unsupported-schema";
		message: string;
	};
	git?: {
		url?: string;
		branch?: string;
	};
	totalCost?: number;
	aggregatedAgentsCost?: number;
	usage?: SessionUsageMetadata;
	aggregateUsage?: SessionUsageMetadata;
	checkpoint?: {
		schemaVersion?: 2;
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

export const TEAM_PROGRESS_EVENT_TYPE = "runtime.team.progress.v1";
export const TEAM_LIFECYCLE_EVENT_TYPE = "runtime.team.lifecycle.v1";

export type TeamProgressMemberRole = "lead" | "teammate";
export type TeamProgressMemberStatus = "idle" | "running" | "stopped";
export type TeamProgressTaskStatus =
	| "pending"
	| "in_progress"
	| "blocked"
	| "completed";
export type TeamProgressRunStatus =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "interrupted";
export type TeamProgressOutcomeStatus = "draft" | "in_review" | "finalized";
export type TeamProgressOutcomeFragmentStatus =
	| "draft"
	| "reviewed"
	| "rejected";

export interface TeamProgressCounts<TStatus extends string> {
	total: number;
	byStatus: Record<TStatus, number>;
}

export interface TeamProgressSummary {
	teamName: string;
	updatedAt: string;
	members: TeamProgressCounts<TeamProgressMemberStatus> & {
		leadCount: number;
		teammateCount: number;
	};
	tasks: TeamProgressCounts<TeamProgressTaskStatus> & {
		blockedTaskIds: string[];
		readyTaskIds: string[];
		completionPct: number;
	};
	runs: TeamProgressCounts<TeamProgressRunStatus> & {
		activeRunIds: string[];
		latestRunId?: string;
	};
	outcomes: TeamProgressCounts<TeamProgressOutcomeStatus> & {
		finalizedPct: number;
		missingRequiredSections: string[];
	};
	fragments: TeamProgressCounts<TeamProgressOutcomeFragmentStatus>;
}

export interface TeamProgressLifecycleEvent {
	teamName: string;
	sessionId: string;
	eventType: string;
	ts: string;
	agentId?: string;
	taskId?: string;
	runId?: string;
	outcomeId?: string;
	fragmentId?: string;
	message?: string;
}

export interface TeamProgressProjectionEvent {
	type: "team_progress_projection";
	version: 1;
	sessionId: string;
	summary: TeamProgressSummary;
	lastEvent: TeamProgressLifecycleEvent;
}

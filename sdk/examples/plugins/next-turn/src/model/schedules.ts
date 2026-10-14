import { TEAM_COMPLETE_PCT } from "../config";
import type { HubFold, ScheduleFold, TeamFold } from "../hub/fold";

/**
 * Schedules and teams as the Status Hub and the Tasks page read them
 *.
 */

/** Execution statuses that mean a scheduled run needs the person. `aborted` is someone stopping it. */
export const FAILED_EXECUTION_STATUSES: ReadonlySet<string> = new Set([
	"failed",
	"timeout",
]);

export function lastRunFailed(schedule: ScheduleFold): boolean {
	return (
		schedule.status !== undefined &&
		FAILED_EXECUTION_STATUSES.has(schedule.status)
	);
}

export type UpcomingRun = {
	scheduleId: string;
	name: string;
	nextRunAt: string;
};

/** The Tasks page's Upcoming lane: schedules with a next run, soonest first. */
export function upcomingRuns(fold: HubFold): UpcomingRun[] {
	const runs: UpcomingRun[] = [];
	for (const schedule of Object.values(fold.schedules)) {
		if (!schedule.nextRunAt) continue;
		runs.push({
			scheduleId: schedule.scheduleId,
			name: schedule.name ?? schedule.scheduleId,
			nextRunAt: schedule.nextRunAt,
		});
	}
	return runs.sort(
		(a, b) =>
			a.nextRunAt.localeCompare(b.nextRunAt) ||
			a.scheduleId.localeCompare(b.scheduleId),
	);
}

export type TeamState = "blocked" | "running" | "done";

export type TeamSummary = {
	/** `team:<teamName>`, the subject an explicit team row would use. */
	subject: string;
	teamName?: string;
	state: TeamState;
	blockedTasks: number;
	readyTasks: number;
	completionPct?: number;
	updatedAt?: number;
};

/** Blocked if any task is blocked; otherwise running until the team reports complete. */
export function teamSummary(team: TeamFold): TeamSummary {
	const state: TeamState =
		team.blockedTasks > 0
			? "blocked"
			: (team.completionPct ?? 0) >= TEAM_COMPLETE_PCT
				? "done"
				: "running";
	return {
		subject: `team:${team.teamName ?? team.sessionId}`,
		teamName: team.teamName,
		state,
		blockedTasks: team.blockedTasks,
		readyTasks: team.readyTasks,
		completionPct: team.completionPct,
		updatedAt: team.updatedAt,
	};
}

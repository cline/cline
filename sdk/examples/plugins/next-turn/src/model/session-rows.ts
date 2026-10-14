import type { HubFold, RunState, SessionFold } from "../hub/fold";
import {
	lastRunFailed,
	scheduleWorkspace,
	type TeamSummary,
	teamSummary,
} from "./schedules";

/**
 * Implicit status: one row per live session, derived from the fold
 * and never stored. An agent that never calls `report_status` still shows up;
 * one that does has its explicit rows nested under its session row instead of
 * listed twice.
 */

export type SessionRowState =
	| "waiting"
	| "failed"
	| "interrupted"
	| "running"
	| "stopped"
	| "done";

/** Attention order: what needs the person first, finished work last. */
const SESSION_ROW_ORDER: readonly SessionRowState[] = [
	"waiting",
	"failed",
	"interrupted",
	"running",
	"stopped",
	"done",
];

const ROW_STATE: Readonly<Record<RunState, SessionRowState | undefined>> = {
	idle: undefined,
	running: "running",
	completed: "done",
	failed: "failed",
	aborted: "stopped",
	interrupted: "interrupted",
};

/** The explicit-status fields a session row needs. This is the plugin's own structural slice, so it depends on no host's status schema. */
export type ExplicitStatus = {
	updateId: string;
	subject: string;
	state: string;
	headline: string;
	priority?: string;
	sessionId?: string;
	workspaceRoot?: string;
	createdAt: string;
	supersededAt: string | null;
};

/** Current until superseded; a missing or empty `supersededAt` reads as current. */
export function isLive(report: ExplicitStatus): boolean {
	return !report.supersededAt;
}

export type SessionRow = {
	kind: "session";
	sessionId: string;
	workspaceRoot?: string;
	state: SessionRowState;
	approvals: number;
	questions: number;
	failedToolCalls: number;
	totalCost?: number;
	updatedAt?: number;
	/** This session's current `report_status` rows, in the order given. */
	reports: ExplicitStatus[];
	/** Set when this session is a schedule's latest run. */
	schedule?: { scheduleId: string; name?: string };
	/** Set when this session leads a team. */
	team?: TeamSummary;
};

/** A schedule whose latest run failed and whose session has no row of its own. */
export type ScheduleRow = {
	kind: "schedule";
	scheduleId: string;
	name?: string;
	sessionId?: string;
	endedAt?: number;
};

/** A team whose lead session has no row of its own. */
export type TeamRow = TeamSummary & { kind: "team"; sessionId: string };

export type StatusBoard = {
	sessions: SessionRow[];
	/** Current explicit rows with no session row to nest under. */
	reports: ExplicitStatus[];
	schedules: ScheduleRow[];
	teams: TeamRow[];
};

export type BoardScope = { workspaceRoot?: string };

export function inScope(
	workspaceRoot: string | undefined,
	scope: BoardScope,
): boolean {
	return (
		!scope.workspaceRoot ||
		!workspaceRoot ||
		workspaceRoot === scope.workspaceRoot
	);
}

export function sessionRowState(
	session: SessionFold,
): SessionRowState | undefined {
	const waiting =
		Object.keys(session.pendingApprovals).length +
		Object.keys(session.pendingQuestions).length;
	return waiting > 0 ? "waiting" : ROW_STATE[session.run];
}

function compareRows(a: SessionRow, b: SessionRow): number {
	const byState =
		SESSION_ROW_ORDER.indexOf(a.state) - SESSION_ROW_ORDER.indexOf(b.state);
	if (byState !== 0) return byState;
	const byRecency = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
	return byRecency !== 0 ? byRecency : a.sessionId.localeCompare(b.sessionId);
}

/**
 * The Status Hub's rows: session rows in attention order, each carrying its
 * session's current explicit rows, schedule and team. Explicit rows, failed
 * schedule runs and teams whose session has no row stand alone, so nothing is
 * listed twice. Superseded explicit rows are dropped.
 */
export function statusBoard(
	fold: HubFold,
	reports: readonly ExplicitStatus[] = [],
	scope: BoardScope = {},
): StatusBoard {
	const rows = new Map<string, SessionRow>();
	for (const session of Object.values(fold.sessions)) {
		const state = sessionRowState(session);
		if (!state || !inScope(session.workspaceRoot, scope)) continue;
		rows.set(session.sessionId, {
			kind: "session",
			sessionId: session.sessionId,
			workspaceRoot: session.workspaceRoot,
			state,
			approvals: Object.keys(session.pendingApprovals).length,
			questions: Object.keys(session.pendingQuestions).length,
			failedToolCalls: session.failedToolCalls.length,
			totalCost: session.totalCost,
			updatedAt: session.updatedAt,
			reports: [],
		});
	}
	const standalone: ExplicitStatus[] = [];
	for (const report of reports) {
		if (!isLive(report) || !inScope(report.workspaceRoot, scope)) continue;
		const row = report.sessionId ? rows.get(report.sessionId) : undefined;
		if (row) row.reports.push(report);
		else standalone.push(report);
	}
	const schedules: ScheduleRow[] = [];
	for (const schedule of Object.values(fold.schedules)) {
		const row = schedule.sessionId ? rows.get(schedule.sessionId) : undefined;
		if (row)
			row.schedule = { scheduleId: schedule.scheduleId, name: schedule.name };
		else if (
			lastRunFailed(schedule) &&
			inScope(scheduleWorkspace(fold, schedule), scope)
		) {
			schedules.push({
				kind: "schedule",
				scheduleId: schedule.scheduleId,
				name: schedule.name,
				sessionId: schedule.sessionId,
				endedAt: schedule.endedAt,
			});
		}
	}
	const teams: TeamRow[] = [];
	for (const team of Object.values(fold.teams)) {
		const row = rows.get(team.sessionId);
		if (row) row.team = teamSummary(team);
		else if (inScope(fold.sessions[team.sessionId]?.workspaceRoot, scope))
			teams.push({
				kind: "team",
				sessionId: team.sessionId,
				...teamSummary(team),
			});
	}
	return {
		sessions: [...rows.values()].sort(compareRows),
		reports: standalone,
		schedules: schedules.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)),
		teams,
	};
}

export function sessionRowFor(
	board: StatusBoard,
	sessionId: string,
): SessionRow | undefined {
	return board.sessions.find((row) => row.sessionId === sessionId);
}

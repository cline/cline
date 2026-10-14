import {
	DEFAULT_TASK_PRIORITY,
	FACTS_BUDGET_MS,
	OTHER_STATUS_SHOWN,
} from "../config";
import { type Manifest, withinBudget } from "../context/manifest";
import type { HubFold } from "../hub/fold";
import type { BoardScope, ExplicitStatus } from "../model/session-rows";

/**
 * The tracked work around a turn. Tasks come from the engine's fold,
 * never from a per-offer hub read. Status reports come from a Status store
 * when one is wired; until then the status source is absent and the planner
 * hears nothing about it. A work graph and plan bank arrive only through a
 * host-supplied `PlanAdapter`.
 */

export type StatusRow = {
	subject: string;
	state: string;
	headline: string;
	priority?: string;
	sessionId?: string;
};

export type TaskRow = {
	taskId: string;
	title: string;
	status: string;
	priority: number;
	/** Epoch ms the fold last saw the task change; orders equal priorities oldest first. */
	updatedAt: number;
};

export type Bank = { nowTitle?: string; nextTitle?: string };

/** One work-graph item near this chat's work, in the planner's words. */
export type PlanItem = {
	label: string;
	title: string;
	status: string;
	project?: string;
	linked: boolean;
	waitingOn: readonly string[];
	ready: boolean;
};

/** A host-supplied work graph and plan bank. A stock install has neither, so the `plan` source is absent there. */
export interface PlanAdapter {
	plan(sessionId: string, subjects: readonly string[]): Promise<PlanItem[]>;
	bank(): Promise<Bank | null>;
}

export type Backlog = {
	statusRows: readonly StatusRow[];
	otherStatusRows: readonly StatusRow[];
	tasks: readonly TaskRow[];
	bank: Bank | null;
	plan: readonly PlanItem[];
};

export const EMPTY_BACKLOG: Backlog = {
	statusRows: [],
	otherStatusRows: [],
	tasks: [],
	bank: null,
	plan: [],
};

/** The task statuses a suggestion can act on, most actionable first. */
const RANKED_TASK_STATUSES = [
	"in_progress",
	"approved",
	"pending_approval",
] as const;

/** Another chat's report is worth the planner's attention only while it is open. */
const OPEN_STATUS_STATES: ReadonlySet<string> = new Set([
	"blocked",
	"failed",
	"running",
	"queued",
]);

function taskRank(status: string): number {
	return RANKED_TASK_STATUSES.indexOf(
		status as (typeof RANKED_TASK_STATUSES)[number],
	);
}

/** In progress, approved, then the agent's proposals awaiting approval; priority, then age, inside each. */
export function rankTasks(tasks: readonly TaskRow[]): TaskRow[] {
	return tasks
		.filter((task) => taskRank(task.status) !== -1)
		.sort(
			(a, b) =>
				taskRank(a.status) - taskRank(b.status) ||
				a.priority - b.priority ||
				a.updatedAt - b.updatedAt,
		);
}

/** The fold's tasks in this workspace, as ranking rows. */
export function tasksFromFold(fold: HubFold, scope: BoardScope): TaskRow[] {
	return Object.values(fold.tasks)
		.filter(
			(task) =>
				!scope.workspaceRoot ||
				!task.workspaceRoot ||
				task.workspaceRoot === scope.workspaceRoot,
		)
		.map((task) => ({
			taskId: task.taskId,
			title: task.title,
			status: task.status,
			priority: task.priority ?? DEFAULT_TASK_PRIORITY,
			updatedAt: task.updatedAt ?? 0,
		}));
}

function statusRow(report: ExplicitStatus): StatusRow {
	return {
		subject: report.subject,
		state: report.state,
		headline: report.headline,
		...(report.priority ? { priority: report.priority } : {}),
		...(report.sessionId ? { sessionId: report.sessionId } : {}),
	};
}

/**
 * This chat's live reports, and other chats' open ones. Reports about a
 * subject this chat already reported are this chat's business, so they are
 * not repeated as another agent's.
 */
export function splitReports(
	reports: readonly ExplicitStatus[],
	sessionId: string,
): Pick<Backlog, "statusRows" | "otherStatusRows"> {
	const live = reports.filter((report) => !report.supersededAt);
	const own = live
		.filter((report) => report.sessionId === sessionId)
		.map(statusRow);
	const ownSubjects = new Set(own.map((row) => row.subject));
	const others = live
		.filter(
			(report) =>
				report.sessionId !== sessionId &&
				!ownSubjects.has(report.subject) &&
				OPEN_STATUS_STATES.has(report.state),
		)
		.map(statusRow)
		.slice(0, OTHER_STATUS_SHOWN);
	return { statusRows: own, otherStatusRows: others };
}

export type BacklogDeps = {
	sessionId: string;
	fold: () => HubFold;
	scope: BoardScope;
	/** The Status store's reports; without one the status source is absent. */
	reports?: () => Promise<readonly ExplicitStatus[]>;
	plan?: PlanAdapter;
	budgetMs?: number;
};

/**
 * Reads the backlog for one turn: only the sources the manifest calls present,
 * each read under the T2 facts budget. Tasks are the fold's, so they cost no
 * read; a report or plan read that fails or runs late reads as empty, and
 * the manifest already told the planner whether the source exists.
 */
export function backlogReader(
	deps: BacklogDeps,
): (manifest: Pick<Manifest, "sources">) => Promise<Backlog> {
	const budget = deps.budgetMs ?? FACTS_BUDGET_MS.T2;
	return async (manifest) => {
		const present = (id: string) => manifest.sources[id] === "present";
		const [reports, bank] = await Promise.all([
			present("status") && deps.reports
				? withinBudget(deps.reports, budget, [] as readonly ExplicitStatus[])
				: [],
			present("plan") && deps.plan
				? withinBudget(() => deps.plan?.bank() ?? null, budget, null)
				: null,
		]);
		const split = splitReports(reports, deps.sessionId);
		const subjects = split.statusRows.map((row) => row.subject);
		const plan =
			present("plan") && deps.plan
				? await withinBudget(
						() => deps.plan?.plan(deps.sessionId, subjects) ?? [],
						budget,
						[] as PlanItem[],
					)
				: [];
		return {
			...split,
			tasks: present("tasks") ? tasksFromFold(deps.fold(), deps.scope) : [],
			bank,
			plan,
		};
	};
}

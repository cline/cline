import { URGENT_TASK_PRIORITY_MAX } from "../config";
import type { HubFold } from "../hub/fold";
import { lastRunFailed, scheduleWorkspace } from "./schedules";
import {
	type BoardScope,
	type ExplicitStatus,
	inScope,
	isLive,
} from "./session-rows";

/**
 * Every item opens where it is answered; none is answered from the list. An
 * approval's input and policy belong in its conversation, and the hub would
 * accept a reply from any client.
 */

export type Urgency = "critical" | "high" | "normal";

/** Most urgent first. Approvals and questions stop an agent, which is what `critical` means in the protocol. */
const URGENCY_ORDER: readonly Urgency[] = ["critical", "high", "normal"];

export type Opens =
	| { kind: "chat"; sessionId: string }
	| { kind: "task"; taskId: string }
	| { kind: "schedule"; scheduleId: string }
	| { kind: "status"; subject: string };

type ItemBase = {
	/** Unique across kinds; `newItems` compares on it. */
	key: string;
	urgency: Urgency;
	/** When it started waiting, in epoch milliseconds, if known. */
	since?: number;
	workspaceRoot?: string;
	opens: Opens;
};

export type NeedsYouItem =
	| (ItemBase & {
			kind: "approval";
			approvalId: string;
			sessionId: string;
			toolName?: string;
	  })
	| (ItemBase & { kind: "question"; requestId: string; sessionId: string })
	| (ItemBase & {
			kind: "task";
			taskId: string;
			title: string;
			priority?: number;
	  })
	| (ItemBase & {
			kind: "schedule";
			scheduleId: string;
			name?: string;
			executionId?: string;
			sessionId?: string;
	  })
	| (ItemBase & {
			kind: "status";
			updateId: string;
			subject: string;
			headline: string;
			state: ExplicitStatus["state"];
			priority: ExplicitStatus["priority"];
			sessionId?: string;
	  });

function statusUrgency(report: ExplicitStatus): Urgency | undefined {
	if (report.priority === "critical") return "critical";
	if (report.priority === "high" || report.state === "blocked") return "high";
	return undefined;
}

function compareItems(a: NeedsYouItem, b: NeedsYouItem): number {
	const byUrgency =
		URGENCY_ORDER.indexOf(a.urgency) - URGENCY_ORDER.indexOf(b.urgency);
	if (byUrgency !== 0) return byUrgency;
	const bySince =
		(a.since ?? Number.POSITIVE_INFINITY) -
		(b.since ?? Number.POSITIVE_INFINITY);
	return bySince || a.key.localeCompare(b.key);
}

function fromSessions(fold: HubFold, scope: BoardScope): NeedsYouItem[] {
	const items: NeedsYouItem[] = [];
	for (const session of Object.values(fold.sessions)) {
		if (!inScope(session.workspaceRoot, scope)) continue;
		const opens: Opens = { kind: "chat", sessionId: session.sessionId };
		for (const [approvalId, pending] of Object.entries(
			session.pendingApprovals,
		)) {
			items.push({
				kind: "approval",
				key: `approval:${approvalId}`,
				approvalId,
				sessionId: session.sessionId,
				toolName: pending.toolName,
				urgency: "critical",
				since: pending.at,
				workspaceRoot: session.workspaceRoot,
				opens,
			});
		}
		for (const [requestId, pending] of Object.entries(
			session.pendingQuestions,
		)) {
			items.push({
				kind: "question",
				key: `question:${requestId}`,
				requestId,
				sessionId: session.sessionId,
				urgency: "critical",
				since: pending.at,
				workspaceRoot: session.workspaceRoot,
				opens,
			});
		}
	}
	return items;
}

function fromTasks(fold: HubFold, scope: BoardScope): NeedsYouItem[] {
	const items: NeedsYouItem[] = [];
	for (const task of Object.values(fold.tasks)) {
		if (
			task.status !== "pending_approval" ||
			!inScope(task.workspaceRoot, scope)
		)
			continue;
		items.push({
			kind: "task",
			key: `task:${task.taskId}`,
			taskId: task.taskId,
			title: task.title,
			priority: task.priority,
			urgency:
				task.priority !== undefined && task.priority <= URGENT_TASK_PRIORITY_MAX
					? "high"
					: "normal",
			since: task.updatedAt,
			workspaceRoot: task.workspaceRoot,
			opens: { kind: "task", taskId: task.taskId },
		});
	}
	return items;
}

function fromSchedules(fold: HubFold, scope: BoardScope): NeedsYouItem[] {
	const items: NeedsYouItem[] = [];
	for (const schedule of Object.values(fold.schedules)) {
		const workspaceRoot = scheduleWorkspace(fold, schedule);
		if (!lastRunFailed(schedule) || !inScope(workspaceRoot, scope)) continue;
		items.push({
			kind: "schedule",
			key: `schedule:${schedule.scheduleId}:${schedule.executionId ?? "latest"}`,
			scheduleId: schedule.scheduleId,
			name: schedule.name,
			executionId: schedule.executionId,
			sessionId: schedule.sessionId,
			urgency: "high",
			since: schedule.endedAt,
			workspaceRoot,
			opens: schedule.sessionId
				? { kind: "chat", sessionId: schedule.sessionId }
				: { kind: "schedule", scheduleId: schedule.scheduleId },
		});
	}
	return items;
}

function fromReports(
	reports: readonly ExplicitStatus[],
	scope: BoardScope,
): NeedsYouItem[] {
	const items: NeedsYouItem[] = [];
	for (const report of reports) {
		const urgency = statusUrgency(report);
		if (!urgency || !isLive(report) || !inScope(report.workspaceRoot, scope))
			continue;
		const created = Date.parse(report.createdAt);
		items.push({
			kind: "status",
			key: `status:${report.updateId}`,
			updateId: report.updateId,
			subject: report.subject,
			headline: report.headline,
			state: report.state,
			priority: report.priority,
			sessionId: report.sessionId,
			urgency,
			since: Number.isFinite(created) ? created : undefined,
			workspaceRoot: report.workspaceRoot,
			opens: report.sessionId
				? { kind: "chat", sessionId: report.sessionId }
				: { kind: "status", subject: report.subject },
		});
	}
	return items;
}

/** The ranked list: most urgent first, then longest waiting. */
export function needsYou(
	fold: HubFold,
	reports: readonly ExplicitStatus[] = [],
	scope: BoardScope = {},
): NeedsYouItem[] {
	return [
		...fromSessions(fold, scope),
		...fromTasks(fold, scope),
		...fromSchedules(fold, scope),
		...fromReports(reports, scope),
	].sort(compareItems);
}

/** Items in `next` whose keys `previous` did not have, in `next`'s order. */
export function newItems(
	previous: readonly NeedsYouItem[],
	next: readonly NeedsYouItem[],
): NeedsYouItem[] {
	const seen = new Set(previous.map((item) => item.key));
	return next.filter((item) => !seen.has(item.key));
}

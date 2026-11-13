import { z } from "zod";
import type { AgendaTaskRecord, AgendaTaskStatus } from "./tasks";

/**
 * A Factory card's priority, separate from the agenda's numeric
 * `AgendaTaskRecord.priority` (part of the task spec, changed only by an
 * edit that revises the plan). Absent means No priority.
 *
 * It orders the Factory queue and the Needs you list; it never preempts
 * running work and changes nothing about review, approval, spending or
 * stage selection.
 */
export const FACTORY_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export const factoryPrioritySchema = z.enum(FACTORY_PRIORITIES);
export type FactoryPriority = z.infer<typeof factoryPrioritySchema>;

/**
 * Who set it: the user (from the card, or by confirming a change the
 * Factory manager chat proposed), the Factory manager chat on the user's
 * request, an agent filing the card, or the scoper's estimate.
 */
export const FACTORY_PRIORITY_SETTERS = [
	"person",
	"manager",
	"agent",
	"scoper",
] as const;
export type FactoryPrioritySetter = (typeof FACTORY_PRIORITY_SETTERS)[number];

export const FACTORY_PRIORITY_REASON_MAX = 200;

/**
 * A stored level: a priority, or `none` when the user or the manager chat
 * cleared it, which the scoper's estimate then never replaces.
 */
export type FactoryPriorityLevel = FactoryPriority | "none";

export const factoryPriorityStateSchema = z.object({
	level: z.enum([...FACTORY_PRIORITIES, "none"]),
	by: z.enum(FACTORY_PRIORITY_SETTERS),
	/** Why: the scoper's basis for its estimate. */
	reason: z.string().max(FACTORY_PRIORITY_REASON_MAX).optional(),
	at: z.string(),
});
export type FactoryPriorityState = z.infer<typeof factoryPriorityStateSchema>;

/** What a writer supplies; the manager clamps it and stamps `at`. */
export type FactoryPriorityInput = Omit<FactoryPriorityState, "at">;

export const FACTORY_PRIORITY_LABEL: Record<FactoryPriorityLevel, string> = {
	urgent: "Urgent",
	high: "High",
	medium: "Medium",
	low: "Low",
	none: "No priority",
};

/**
 * Sort rank, lower first. No priority ranks with Medium, so boards where
 * nothing is marked keep their order and Low demotes a card.
 */
export const FACTORY_PRIORITY_RANK: Record<FactoryPriorityLevel, number> = {
	urgent: 0,
	high: 1,
	medium: 2,
	none: 2,
	low: 3,
};
export const FACTORY_PRIORITY_NONE_RANK = FACTORY_PRIORITY_RANK.none;

export function factoryPriorityRank(task: {
	factoryPriority?: Pick<FactoryPriorityState, "level">;
}): number {
	return task.factoryPriority
		? FACTORY_PRIORITY_RANK[task.factoryPriority.level]
		: FACTORY_PRIORITY_NONE_RANK;
}

/** Only a person marks a card Urgent; anyone else's Urgent is High. */
export function clampFactoryPriority<Level extends FactoryPriorityLevel>(
	level: Level,
	by: FactoryPrioritySetter,
): Level | "high" {
	return level === "urgent" && by !== "person" ? "high" : level;
}

/** By rank alone; stable sorts keep the caller's order within a rank. */
export function compareFactoryPriority(
	a: { factoryPriority?: Pick<FactoryPriorityState, "level"> },
	b: { factoryPriority?: Pick<FactoryPriorityState, "level"> },
): number {
	return factoryPriorityRank(a) - factoryPriorityRank(b);
}

/**
 * The Factory queue's order, as the engine starts work: rank, then when the
 * card was queued (`factoryQueuedAt`), then task id.
 */
export function compareFactoryQueue(
	a: {
		taskId: string;
		factoryPriority?: Pick<FactoryPriorityState, "level">;
		factoryQueuedAt?: string;
	},
	b: {
		taskId: string;
		factoryPriority?: Pick<FactoryPriorityState, "level">;
		factoryQueuedAt?: string;
	},
): number {
	return (
		compareFactoryPriority(a, b) ||
		(a.factoryQueuedAt ?? "").localeCompare(b.factoryQueuedAt ?? "") ||
		a.taskId.localeCompare(b.taskId)
	);
}

const AGENDA_STATUS_ORDER: Record<AgendaTaskStatus, number> = {
	in_progress: 0,
	pending_approval: 1,
	approved: 2,
	failed: 3,
	completed: 4,
	expired: 5,
	cancelled: 6,
};

type AgendaOrderFields = Pick<
	AgendaTaskRecord,
	"taskId" | "status" | "priority" | "availableAt" | "createdAt"
>;

/**
 * The agenda's own order, as the desktop lists tasks: status (working
 * first), the agenda's numeric priority, when the task became available,
 * then the oldest, then task id.
 */
export function compareAgendaTasks(
	a: AgendaOrderFields,
	b: AgendaOrderFields,
): number {
	const available = Date.parse(a.availableAt) - Date.parse(b.availableAt);
	return (
		AGENDA_STATUS_ORDER[a.status] - AGENDA_STATUS_ORDER[b.status] ||
		a.priority - b.priority ||
		(Number.isFinite(available) ? available : 0) ||
		Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
		a.taskId.localeCompare(b.taskId)
	);
}

/**
 * Needs you order, the one the board and `factory_status` both use: the
 * Factory priority rank (the user's explicit statement), then the urgency
 * class of what the card waits for (`factoryNeedsYouUrgency`), then the
 * agenda's own order. With no priorities
 * set the board keeps the order it always had.
 */
export function compareFactoryNeedsYou(
	a: {
		task: AgendaOrderFields & {
			factoryPriority?: Pick<FactoryPriorityState, "level">;
		};
		urgency: number;
	},
	b: {
		task: AgendaOrderFields & {
			factoryPriority?: Pick<FactoryPriorityState, "level">;
		};
		urgency: number;
	},
): number {
	return (
		compareFactoryPriority(a.task, b.task) ||
		a.urgency - b.urgency ||
		compareAgendaTasks(a.task, b.task)
	);
}

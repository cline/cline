"use client";

import type {
	AgendaTaskRecord,
	FactoryCardState,
	FactoryPriority,
	FactoryPriorityState,
} from "@cline/shared";
import {
	factoryCardState,
	formatFactoryId,
	isFactoryHandsOff,
} from "@cline/shared/browser";
import {
	AlertTriangle,
	CheckCircle2,
	ClipboardCheck,
	GitPullRequest,
	ListTree,
	MessageCircleQuestion,
	Sparkles,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { UseAgendaTasksResult } from "@/hooks/use-agenda-tasks";
import type {
	FactoryAttention,
	useFactoryAttention,
} from "@/hooks/use-factory-attention";
import {
	currentFactoryConclusion,
	type FactoryCardLinks,
	type FactoryStationState,
	factoryAutoRetryLabel,
	factoryCardInput,
	factoryOutcomeDetails,
	factoryScopingWait,
	factoryStation,
	factoryUnreadable,
	isReplayReviewQueued,
} from "@/lib/factory-attention";
import {
	FACTORY_ACTIVITY,
	FACTORY_DECISION,
	FACTORY_LINE,
	FACTORY_PRIORITY,
	FACTORY_READY,
	FACTORY_ROW_ACTION,
	FACTORY_RULE_CARD,
	FACTORY_SPLIT,
	FACTORY_UNREADABLE,
	factoryFeedbackLabel,
	factoryPhaseLabel,
} from "@/lib/factory-copy";
import { cn } from "@/lib/utils";

export type FactoryTone =
	| "neutral"
	| "attention"
	| "working"
	| "success"
	| "danger"
	| "accent";

/** The theme's step-11 text tokens, which keep 4.5:1 on their tints. */
const TONE_TEXT: Record<FactoryTone, string> = {
	neutral: "text-muted-foreground",
	attention: "text-warning-text",
	working: "text-info-text",
	success: "text-success-text",
	danger: "text-error-text",
	accent: "text-accent-foreground",
};
const TONE_SURFACE: Record<FactoryTone, string> = {
	neutral: "border-border bg-muted/30",
	attention: "border-amber-500/30 bg-amber-500/10",
	working: "border-sky-500/30 bg-sky-500/10",
	success: "border-emerald-500/30 bg-emerald-500/10",
	danger: "border-destructive/30 bg-destructive/10",
	accent: "border-primary/30 bg-primary/10",
};
const TONE_DOT: Record<FactoryTone, string> = {
	neutral: "bg-muted-foreground/50",
	attention: "bg-amber-500",
	working: "bg-sky-500",
	success: "bg-emerald-500",
	danger: "bg-destructive",
	accent: "bg-primary",
};

export const toneText = (tone: FactoryTone) => TONE_TEXT[tone];
export const toneSurface = (tone: FactoryTone) => TONE_SURFACE[tone];
export const toneDot = (tone: FactoryTone) => TONE_DOT[tone];

export function StatusPill({
	tone = "neutral",
	icon: Icon,
	children,
	className,
}: {
	tone?: FactoryTone;
	icon?: ComponentType<{ className?: string }>;
	children: ReactNode;
	className?: string;
}) {
	return (
		<Badge
			variant="outline"
			className={cn(TONE_SURFACE[tone], TONE_TEXT[tone], className)}
		>
			{Icon ? <Icon /> : null}
			{children}
		</Badge>
	);
}

export function Panel({
	title,
	description,
	actions,
	children,
	className,
	bodyClassName,
	...rest
}: {
	title?: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
	bodyClassName?: string;
	"aria-label"?: string;
	id?: string;
}) {
	return (
		<section className={cn("rounded-lg border bg-card", className)} {...rest}>
			{title || actions ? (
				<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-5 py-3">
					<div className="min-w-0">
						<h3 className="text-sm font-semibold">{title}</h3>
						{description ? (
							<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
								{description}
							</p>
						) : null}
					</div>
					{actions ? (
						<div className="flex shrink-0 flex-wrap items-center gap-2">
							{actions}
						</div>
					) : null}
				</div>
			) : null}
			<div className={cn("space-y-3 px-5 py-4", bodyClassName)}>{children}</div>
		</section>
	);
}

/**
 * Marks a card Factory filed itself for a pattern reviewers kept finding.
 * The explanation is the badge's tooltip and accessible description.
 */
export function FactoryRuleBadge({ className }: { className?: string }) {
	return (
		<Badge
			variant="outline"
			title={FACTORY_RULE_CARD.explanation}
			className={cn(
				"shrink-0",
				TONE_SURFACE.accent,
				TONE_TEXT.accent,
				className,
			)}
		>
			<Sparkles aria-hidden />
			{FACTORY_RULE_CARD.badge}
			<span className="sr-only">. {FACTORY_RULE_CARD.explanation}</span>
		</Badge>
	);
}

/** A card's short id, such as "F42", when the Hub numbered it. */
export function factoryShortId(
	task: Pick<AgendaTaskRecord, "factoryNumber">,
): string | undefined {
	return typeof task.factoryNumber === "number"
		? formatFactoryId(task.factoryNumber)
		: undefined;
}

/**
 * The quiet monospace chip before a card's title. Its text is part of the
 * row's accessible name, so "F42 Export activity" is read as one.
 */
export function FactoryIdChip({
	task,
	className,
}: {
	task: Pick<AgendaTaskRecord, "factoryNumber">;
	className?: string;
}) {
	const id = factoryShortId(task);
	if (!id) return null;
	return (
		<span
			data-factory-id
			className={cn(
				"shrink-0 rounded border border-border/70 px-1 font-mono text-[11px] font-normal leading-4 text-muted-foreground tabular-nums",
				className,
			)}
		>
			{id}
		</span>
	);
}

/** Signal bars filled per level: Low one, Medium two, High three. */
const PRIORITY_BARS: Record<Exclude<FactoryPriority, "urgent">, number> = {
	low: 1,
	medium: 2,
	high: 3,
};

/**
 * A priority level drawn as Linear draws it: signal bars for Low, Medium and
 * High, an orange square with "!" for Urgent, three dashes for No priority
 * (shown only where a level is chosen). Decorative: callers name it.
 */
export function FactoryPriorityGlyph({
	level,
	className,
}: {
	level: FactoryPriority | "none";
	className?: string;
}) {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 16 16"
			data-factory-priority-glyph={level}
			// Urgent stays orange wherever it is drawn, a muted menu included.
			className={cn(
				"size-3.5 shrink-0",
				className,
				level === "urgent" && "text-orange-500",
			)}
		>
			{level === "urgent" ? (
				<>
					<rect x="1" y="1" width="14" height="14" rx="3" fill="currentColor" />
					<rect x="7" y="3.75" width="2" height="5.5" rx="1" fill="white" />
					<circle cx="8" cy="11.5" r="1.25" fill="white" />
				</>
			) : (
				[
					{ x: 1.5, y: 8, height: 6 },
					{ x: 6.5, y: 5, height: 9 },
					{ x: 11.5, y: 2, height: 12 },
				].map((bar, index) =>
					level === "none" ? (
						<rect
							key={bar.x}
							x={bar.x}
							y="7.25"
							width="3"
							height="1.5"
							rx="0.75"
							fill="currentColor"
						/>
					) : (
						<rect
							key={bar.x}
							x={bar.x}
							y={bar.y}
							width="3"
							height={bar.height}
							rx="1"
							fill="currentColor"
							fillOpacity={index < PRIORITY_BARS[level] ? 1 : 0.3}
						/>
					),
				)
			)}
		</svg>
	);
}

/**
 * A card's priority, named "High priority", with who set it as its tooltip;
 * nothing when the card has none.
 */
/** A priority to show: a cleared one ("none") shows like no priority. */
export function hasFactoryPriority(
	priority: FactoryPriorityState | undefined,
): priority is FactoryPriorityState & { level: FactoryPriority } {
	return priority !== undefined && priority.level !== "none";
}

export function FactoryPriorityIcon({
	priority,
	className,
}: {
	priority: FactoryPriorityState | undefined;
	className?: string;
}) {
	if (!hasFactoryPriority(priority)) return null;
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					role="img"
					aria-label={FACTORY_PRIORITY.level(priority.level)}
					data-factory-priority={priority.level}
					className={cn("flex shrink-0", className)}
				>
					<FactoryPriorityGlyph level={priority.level} />
				</span>
			</TooltipTrigger>
			<TooltipContent className="max-w-72">
				{FACTORY_PRIORITY.tooltip(priority)}
			</TooltipContent>
		</Tooltip>
	);
}

/**
 * The Factory cards and their attention, loaded once for the app: the
 * sidebar's Factory group and the Factory page share one subscription.
 */
export type FactoryBoardData = {
	agenda: UseAgendaTasksResult;
	attention: ReturnType<typeof useFactoryAttention>;
};

/** The task list Factory reads; every Factory card in every workspace. */
export const FACTORY_AGENDA_FILTERS = {
	allWorkspaces: true,
	includeArchived: true,
	limit: 200,
	// A split's parent, parts and earlier parts, even beyond the limit.
	factoryLinks: true,
} as const;

/**
 * Asks the Factory page to show Activity rather than a card. Passed where a
 * task id is requested, e.g. by the sidebar's Factory entry.
 */
export const FACTORY_ACTIVITY_REQUEST = "factory:activity";

/**
 * Attention that describes each card as it is now: loaded, for the card's
 * current revision and run. Anything else would show a stale state.
 */
export function factoryCurrentAttention(
	tasks: readonly AgendaTaskRecord[],
	{ agenda, attention }: FactoryBoardData,
): Map<string, FactoryAttention> {
	const tasksById = new Map(tasks.map((task) => [task.taskId, task]));
	return new Map(
		attention.items
			.filter((item) => {
				const task = tasksById.get(item.taskId);
				return (
					attention.transportReady &&
					attention.hasLoaded &&
					!attention.error &&
					!agenda.error &&
					Boolean(task) &&
					// An unreadable card has no revision or run to compare.
					(factoryUnreadable(item) !== undefined ||
						(task?.revision === item.revision &&
							(!item.outcome ||
								item.runId === (task.currentRunId ?? task.lastRunId))))
				);
			})
			.map((item) => [item.taskId, item]),
	);
}

/**
 * What a card asks of the user. The Factory home's columns, the card rail and
 * the app sidebar group by these; where it is on the line is its `station`.
 */
type FactoryColumn =
	| "Queued"
	| "Working"
	| "Needs you"
	| "Ready for you"
	| "Done";

export type FactoryActivity = {
	column: FactoryColumn | "Status unavailable";
	label: string;
	/** The colour of the card's dot, icon and label on every surface. */
	tone: FactoryTone;
	/** The verb on the card's row. */
	action: string;
	/** Set when the card's stored data could not be read: the short reason. */
	unreadable?: string;
	/** Where the card is on the line, from `factoryStation`. */
	station: FactoryStationState;
	/**
	 * A split's card: a parent, which only tracks its parts, or a part that
	 * waits for earlier parts and, when one will never merge, why.
	 */
	split?: { parent?: true; waiting?: true; unmerged?: string };
};

/** How each decision or result looks: its colour, icon and row verb. */
export function factoryDecisionStyle(label: string): {
	tone: FactoryTone;
	icon: ComponentType<{ className?: string }>;
	action: string;
} {
	switch (label) {
		case FACTORY_DECISION.question:
			return {
				tone: "attention",
				icon: MessageCircleQuestion,
				action: FACTORY_ROW_ACTION.answer,
			};
		case FACTORY_DECISION.failure:
		case FACTORY_DECISION.blocker:
			return {
				tone: "danger",
				icon: AlertTriangle,
				action: FACTORY_LINE.tryAgain,
			};
		case FACTORY_DECISION.rule:
			return {
				tone: "attention",
				icon: Sparkles,
				action: FACTORY_ROW_ACTION.review,
			};
		case FACTORY_DECISION.followup:
			return {
				tone: "attention",
				icon: GitPullRequest,
				action: FACTORY_ROW_ACTION.resume,
			};
		case FACTORY_DECISION.plan:
			return {
				tone: "accent",
				icon: ClipboardCheck,
				action: FACTORY_ROW_ACTION.approvePlan,
			};
		case FACTORY_DECISION.breakdown:
			return {
				tone: "accent",
				icon: ListTree,
				action: FACTORY_ROW_ACTION.review,
			};
		case FACTORY_DECISION.unmerged:
			return {
				tone: "attention",
				icon: AlertTriangle,
				action: FACTORY_ROW_ACTION.open,
			};
		case FACTORY_READY.needsReview:
			return {
				tone: "attention",
				icon: ClipboardCheck,
				action: FACTORY_ROW_ACTION.review,
			};
		case FACTORY_READY.draftPr:
			return {
				tone: "success",
				icon: GitPullRequest,
				action: FACTORY_ROW_ACTION.review,
			};
		default:
			return {
				tone: "success",
				icon: CheckCircle2,
				action: FACTORY_ROW_ACTION.review,
			};
	}
}

/**
 * Whether a card waits on the person: stopped work, questions, plans to
 * approve, results to review and deliveries they flagged. A delivery nobody
 * rated does not: feedback is optional. The home's Needs you group and the
 * sidebar's Factory badge count the same cards.
 */
export function factoryNeedsYou(
	activity: Pick<FactoryActivity, "column" | "label">,
): boolean {
	return (
		activity.column === "Needs you" ||
		(activity.column === "Ready for you" &&
			activity.label === FACTORY_READY.needsReview)
	);
}

/**
 * Whether the board's Needs you column lists the card: a decision, or a card
 * whose stored data could not be read. The sidebar's count uses the same.
 */
export function factoryInNeedsYouColumn(
	activity: Pick<FactoryActivity, "column" | "label" | "unreadable">,
): boolean {
	return factoryNeedsYou(activity) || activity.unreadable !== undefined;
}

/**
 * How urgent a decision is, by its label, lowest first: stopped work, then
 * questions, plans, reviews and flagged deliveries. The home's Needs you
 * group, the rail and the app sidebar sort by it.
 */
export function factoryUrgency(label: string): number {
	switch (label) {
		case FACTORY_DECISION.failure:
		case FACTORY_DECISION.blocker:
			return 0;
		case FACTORY_DECISION.question:
			return 1;
		case FACTORY_DECISION.plan:
		case FACTORY_DECISION.noBuild:
		case FACTORY_DECISION.breakdown:
		case FACTORY_DECISION.unmerged:
			return 2;
		case FACTORY_DECISION.rule:
			return 4;
		default:
			return 3;
	}
}

/** Results the user looks at rather than decides on. */
const READY_LABELS = new Set<string>([
	FACTORY_READY.needsReview,
	FACTORY_READY.draftPr,
	FACTORY_READY.changes,
]);

/**
 * Where a card stands and how every surface shows it: the column (home
 * column, rail group, app sidebar), its station on the line, its label,
 * colour and row verb. Surfaces never re-derive any of these.
 */
export function factoryActivity(
	task: AgendaTaskRecord,
	attention: FactoryAttention | undefined,
	options?: { now?: Date },
): FactoryActivity {
	const unreadable = factoryUnreadable(attention);
	if (unreadable !== undefined)
		return {
			column: "Status unavailable",
			label: FACTORY_UNREADABLE.label,
			tone: "danger",
			action: FACTORY_ROW_ACTION.open,
			unreadable,
			station: factoryStation(task, undefined, options),
		};
	const links = factoryAttentionLinks(attention);
	const card = factoryCardState(
		factoryCardInput(task, attention?.outcome, links),
	);
	const split = task.factorySplit
		? { parent: true as const }
		: card.waitingFor
			? {
					waiting: true as const,
					...(links.dependency?.state === "unavailable"
						? { unmerged: links.dependency.reason }
						: {}),
				}
			: undefined;
	return {
		...factoryActivityState(task, attention, card),
		station: factoryStation(task, attention?.outcome, { ...options, links }),
		...(split ? { split } : {}),
	};
}

/** The split link facts the sidecar sent with a card's attention. */
export function factoryAttentionLinks(
	attention: Pick<FactoryAttention, "parts" | "dependency"> | undefined,
): FactoryCardLinks {
	return {
		...(attention?.parts ? { parts: attention.parts } : {}),
		...(attention?.dependency ? { dependency: attention.dependency } : {}),
	};
}

function factoryActivityState(
	task: AgendaTaskRecord,
	attention: FactoryAttention | undefined,
	card: FactoryCardState,
): Omit<FactoryActivity, "station"> {
	const { column, label } = factoryPlacement(task, attention, card);
	const outcome = attention?.outcome;
	// Feedback is optional: a rating, when given, only colours the label;
	// a delivery nobody rated is simply delivered.
	const rated = outcome?.audit?.reviewedAt
		? factoryFeedbackLabel(outcome.audit)
		: undefined;
	if (column === "Needs you" && READY_LABELS.has(label)) {
		// A hands-off delivery the user rated is settled.
		if (isFactoryHandsOff(task.factory) && rated)
			return {
				column: "Done",
				label: rated,
				tone: "success",
				action: FACTORY_ROW_ACTION.open,
			};
		const style = factoryDecisionStyle(label);
		return {
			column: "Ready for you",
			label,
			tone: style.tone,
			action: style.action,
		};
	}
	if (column === "Needs you") {
		const style = factoryDecisionStyle(label);
		return { column, label, tone: style.tone, action: style.action };
	}
	// A finished result is delivered, whatever else it shows: a draft PR
	// still watched for CI is listed once, as delivered.
	if (task.status === "completed" && outcome && column !== "Done")
		return {
			column: "Done",
			label:
				rated ??
				(outcome.pullRequestUrl
					? FACTORY_READY.draftPr
					: FACTORY_READY.changes),
			tone: "success",
			action: FACTORY_ROW_ACTION.open,
		};
	switch (column) {
		case "Working":
			return {
				column,
				label,
				tone: "working",
				action: FACTORY_ROW_ACTION.open,
			};
		case "Done":
			return {
				column,
				label: rated ?? label,
				tone: "success",
				action: FACTORY_ROW_ACTION.open,
			};
		default:
			return {
				column,
				label,
				tone: "neutral",
				action: FACTORY_ROW_ACTION.open,
			};
	}
}

/** The column and label alone, before `factoryActivity` settles the rest. */
function factoryPlacement(
	task: AgendaTaskRecord,
	attention: FactoryAttention | undefined,
	card: FactoryCardState,
): Pick<FactoryActivity, "column" | "label"> {
	const state = attention?.outcome;
	const pendingQuestion =
		attention?.questions.length ||
		task.factoryQuestions?.some(
			(question) =>
				question.status === "pending" && question.revision === task.revision,
		);
	if (pendingQuestion)
		return { column: "Needs you", label: FACTORY_DECISION.question };
	const details = factoryOutcomeDetails(state);
	if (details.autoRetrying)
		return {
			column: "Working",
			label: factoryAutoRetryLabel(details.autoRecovery),
		};
	// Stopped at the repair limit with the draft PR open: the PR is the
	// result, waiting for the user's review rather than a failure.
	if (card.kind === "delivered_with_findings")
		return card.waitingOn === "person"
			? { column: "Needs you", label: FACTORY_READY.needsReview }
			: { column: "Done", label: FACTORY_ACTIVITY.reviewed };
	// A failure, or a run that stopped later (PR follow-up, say). Automatic
	// approval's waiting note is a plan to approve, not a stop.
	if (card.kind === "stopped")
		return {
			column: "Needs you",
			label:
				task.status === "failed" || task.error
					? FACTORY_DECISION.failure
					: FACTORY_DECISION.blocker,
		};
	// A note never asks anything of the person; a rule proposed from it does.
	if (card.reasonCode === "rule_proposed")
		return { column: "Needs you", label: FACTORY_DECISION.rule };
	// A split: the breakdown and a part that cannot start need the person; a
	// part waiting for a merge keeps its place in the queue; a parent tracks
	// beside running work until every part settles.
	switch (card.reasonCode) {
		case "split_approval":
			return { column: "Needs you", label: FACTORY_DECISION.breakdown };
		case "dependency_unavailable":
			return { column: "Needs you", label: FACTORY_DECISION.unmerged };
		case "waiting_on_card":
			return {
				column: "Queued",
				label: card.reasonText ?? FACTORY_ACTIVITY.waitingToStart,
			};
		case "tracking":
			return { column: "Working", label: FACTORY_SPLIT.progress(card.parts) };
		case "parts_delivered":
			return { column: "Done", label: FACTORY_SPLIT.progress(card.parts) };
		// Every part closed undelivered: it leaves the board as closed cards do.
		case "parts_closed":
			return {
				column: "Done",
				label: card.reasonText ?? FACTORY_SPLIT.progress(card.parts),
			};
	}
	const design =
		task.factoryDesignProgress?.revision === task.revision
			? task.factoryDesignProgress
			: undefined;
	const concluded = Boolean(currentFactoryConclusion(task));
	if (isReplayReviewQueued(task))
		return { column: "Queued", label: FACTORY_ACTIVITY.waitingForPlanCheck };
	if (
		(task.status === "pending_approval" || task.status === "approved") &&
		design &&
		design.phase !== "complete"
	)
		return {
			column: "Working",
			label:
				design.phase === "designing"
					? FACTORY_ACTIVITY.scoping
					: FACTORY_ACTIVITY.checkingPlan,
		};
	if (attention?.needsAttention)
		return {
			column: "Needs you",
			label: state?.followupPaused
				? FACTORY_DECISION.followup
				: concluded
					? FACTORY_DECISION.noBuild
					: task.status === "pending_approval"
						? FACTORY_DECISION.plan
						: details.humanReview?.required
							? FACTORY_READY.needsReview
							: details.pullRequestUrl
								? FACTORY_READY.draftPr
								: FACTORY_READY.changes,
		};
	if (state?.humanApproval)
		return { column: "Done", label: FACTORY_ACTIVITY.reviewed };
	if (
		task.status === "in_progress" ||
		(state &&
			[
				"implementing",
				"verifying",
				"reviewing",
				"repairing",
				"publishing",
				"watching",
			].includes(state.phase))
	)
		return {
			column: "Working",
			label: !state
				? FACTORY_ACTIVITY.starting
				: state.phase === "ready"
					? FACTORY_ACTIVITY.finishing
					: factoryPhaseLabel(state.phase),
		};
	if (!attention || task.status === "completed")
		return {
			column: "Status unavailable",
			label: FACTORY_ACTIVITY.statusNotLoaded,
		};
	if (
		task.status === "approved" ||
		(design?.phase === "complete" &&
			!design.conclusion &&
			task.factory?.approval === "automatic")
	)
		return { column: "Queued", label: FACTORY_ACTIVITY.waitingToBuild };
	// Only work really waiting for the scoping agent waits to start.
	const wait = factoryScopingWait(task);
	return {
		column: "Queued",
		label:
			wait === "held"
				? FACTORY_ACTIVITY.onHold
				: wait === "queued"
					? FACTORY_ACTIVITY.waitingToStart
					: design?.phase === "complete"
						? FACTORY_ACTIVITY.planNotReady
						: FACTORY_ACTIVITY.notStarted,
	};
}

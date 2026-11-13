"use client";

import type { AgendaTaskRecord } from "@cline/shared";
import {
	compareFactoryNeedsYou,
	compareFactoryPriority,
	compareFactoryQueue,
	isFactoryHandsOff,
} from "@cline/shared/browser";
import {
	AlertTriangle,
	ArrowLeft,
	ArrowRight,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	CircleDashed,
	Clock,
	ExternalLink,
	Factory as FactoryIcon,
	Flag,
	GitBranch,
	GitPullRequest,
	HelpCircle,
	ListTree,
	Loader2,
	MessageSquare,
	Pause,
	Play,
	RefreshCw,
	RotateCcw,
	Settings,
	SlidersHorizontal,
	XCircle,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgendaTasks } from "@/hooks/use-agenda-tasks";
import {
	type FactoryAttention,
	useFactoryAttention,
} from "@/hooks/use-factory-attention";
import { useFactoryLimits } from "@/hooks/use-factory-limits";
import {
	useFactoryLiveActivity,
	useFactoryNow,
} from "@/hooks/use-factory-live-activity";
import { basenamePath, formatRelativeTime } from "@/hooks/use-session-history";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import {
	currentFactoryConclusion,
	FACTORY_STATIONS,
	factoryAutoApprovalBlocker,
	factoryOpenFindings,
	factoryOutcomeDetails,
	factoryPlanFault,
	factoryPlanFaultStopped,
	factoryPublishFailureReason,
	factoryRepairLimitReason,
	factoryRetryPath,
	isFactoryRuleCard,
} from "@/lib/factory-attention";
import {
	FACTORY_ACTIVITY,
	FACTORY_BOARD,
	FACTORY_CARD_ACTION,
	FACTORY_COMPACT,
	FACTORY_DECISION,
	FACTORY_LINE,
	FACTORY_MANAGER,
	FACTORY_MASTER_DETAIL,
	FACTORY_MESSAGES,
	FACTORY_OPEN_FINDINGS,
	FACTORY_READY,
	FACTORY_RECOVERY,
	FACTORY_SPLIT,
	FACTORY_TERMS,
	FACTORY_UNREADABLE,
	factoryFeedbackLabel,
	factoryHistoryStatus,
	factoryPullRequestActionLabel,
	factoryReviewReason,
	factoryWorkingDetail,
} from "@/lib/factory-copy";
import { factoryProposedRule } from "@/lib/factory-feedback";
import { formatFactoryUsd } from "@/lib/factory-limits";
import { cn } from "@/lib/utils";
import {
	PAGE_FRAME_FIT_VIEWPORT,
	PageEmptyState,
	PageFrame,
} from "../page-layout";
import {
	collapseFactoryBoardColumn,
	DEFAULT_FACTORY_BOARD_VIEW,
	FACTORY_BOARD_GROUPINGS,
	FACTORY_BOARD_OTHER_ID,
	type FactoryBoardGrouping,
	type FactoryBoardResolvedColumn,
	type FactoryBoardRow,
	type FactoryBoardStatus,
	type FactoryBoardView,
	factoryBoardAutoCollapsed,
	factoryBoardCollapsed,
	factoryBoardPinned,
	factoryBoardTier,
	groupFactoryBoard,
	moveFactoryBoardColumn,
	readFactoryBoardView,
	resolveFactoryBoard,
	saveFactoryBoardView,
	setFactoryBoardQueueColumn,
	toggleFactoryBoardColumn,
} from "./factory-board-view";
import { FactoryCardBoundary } from "./factory-card-boundary";
import {
	FactoryWorkingLimit,
	factorySlotsFull,
	factoryWaitingForSlot,
} from "./factory-concurrency";
import { type FactoryDraft, FeatureDetail } from "./factory-detail";
import { FactoryHandsOffNotice } from "./factory-hands-off-notice";
import { FactoryRowStages } from "./factory-line";
import {
	FactoryLiveLine,
	type FactoryLiveSession,
	FactoryWatchButton,
	factoryLiveSessions,
	formatFactoryDuration,
} from "./factory-live";
import { FactorySettingsPage } from "./factory-settings";
import { FactoryParentLink, factorySplitContext } from "./factory-split";
import {
	factoryScopingStopped,
	factoryScopingStopReason,
} from "./factory-task-header";
import {
	FACTORY_ACTIVITY_REQUEST,
	FACTORY_AGENDA_FILTERS,
	type FactoryActivity,
	type FactoryBoardData,
	FactoryIdChip,
	FactoryPriorityIcon,
	FactoryRuleBadge,
	type FactoryTone,
	factoryActivity,
	factoryAttentionLinks,
	factoryCurrentAttention,
	factoryDecisionStyle,
	factoryNeedsYou,
	factoryShortId,
	factoryUrgency,
	hasFactoryPriority,
	StatusPill,
	toneDot,
	toneText,
} from "./factory-ui";
import type { AppSettingsSection } from "./settings/types";
import { useElementSize } from "./use-element-size";

/*
 * Master-detail breakpoints, in Factory's own width (the window less the
 * 260px app sidebar; 1340/1180/1020/764px at 1600/1440/1280/1024px windows):
 * - from 960px (windows of 1220px+) a 72px id rail shows, leaving the card
 *   at least 824px inside its 32px padding;
 * - from 1120px (windows of 1380px+) the 16rem rail shows titles, leaving the
 *   card at least 800px.
 * Both stay above the ~720px the card needs for two columns. Tailwind reads
 * class names literally, so the classes below spell these out.
 *
 * The home is a board (see factory-board-view.ts): one header row, a slim
 * banner only for exceptions, and columns that scroll on their own. The
 * board's own width sets its tier: three columns (Working with its queue,
 * Needs you, Delivered) from 700px and Delivered a strip below that; with
 * the queue as its own column, four from 920px, Waiting a strip from 700px,
 * Waiting and Delivered strips from 552px. Narrower, the board scrolls
 * sideways. The page itself never scrolls.
 */

const QUEUE_STOPPED_KEY = "factory.queueStopped";
const DESTINATION_KEY = "factory.destination";
/** Delivered shows the most recent; All history has the rest. */
const DELIVERED_RECENTLY_LIMIT = 20;
/** Waiting shows this many, then says how many more wait. */
const WAITING_LIMIT = 50;
/** Reduced motion keeps the icon but stops it turning. */
const SPIN = "animate-spin motion-reduce:animate-none";
/** A row that just arrived may transition in, once. */
const ARRIVE =
	"motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300";
/** How long a new delivery keeps its transition. */
const ARRIVE_MS = 600;
/** Labels that mean a card stopped. */
const STOPPED_LABELS = new Set<string>([
	FACTORY_DECISION.failure,
	FACTORY_DECISION.blocker,
]);
/** Stops a retry cannot fix: only editing the plan moves the card on. */
const PLAN_REPAIR_LIMIT = /Plan repair limit \(\d+\) reached/i;

/** The home's status groups; the rail lists them in the board's order. */
type FactoryHomeGroup = FactoryBoardStatus;

/**
 * The home is the one landing page; History and Factory settings open from
 * it. Destinations saved by earlier versions (the Board among them) map onto
 * these.
 */
type FactoryDestination = "activity" | "settings" | "history" | "archived";

function savedDestination(): FactoryDestination {
	if (typeof window === "undefined") return "activity";
	switch (sessionStorage.getItem(DESTINATION_KEY)) {
		case "settings":
		case "workflows":
			return "settings";
		// The feedback queue is gone: feedback is optional, so nothing waits
		// for it. History keeps each delivery's feedback column.
		case "history":
		case "outcomes":
		case "feedback":
		case "samples":
			return "history";
		case "archived":
			return "archived";
		default:
			return "activity";
	}
}

/** A column's dot, by its tone; Needs you is grey while it is empty. */
const COLUMN_DOT: Record<FactoryTone, string> = {
	neutral: "bg-muted-foreground/60",
	attention: "bg-amber-500",
	working: "bg-sky-500",
	success: "bg-emerald-500",
	danger: "bg-destructive",
	accent: "bg-primary",
};

/**
 * One column of the board: a 36px header (dot, name, count, an aside such as
 * the working limit or All history, and a collapse chevron when the column
 * can collapse) over its own scrolling list. Collapsed, it is a 36px strip
 * that expands on click.
 */
function BoardColumn({
	id,
	label,
	tone,
	count,
	pill = false,
	countTitle,
	aside,
	collapsed,
	collapsible,
	alwaysShowCollapse = false,
	onToggle,
	empty,
	footer,
	hold,
	children,
}: {
	id: string;
	label: string;
	tone: FactoryTone;
	count: number;
	/** The amber count pill of a column that waits on the person. */
	pill?: boolean;
	countTitle?: string;
	aside?: ReactNode;
	collapsed: boolean;
	collapsible: boolean;
	/** The width would collapse it: its chevron always shows. */
	alwaysShowCollapse?: boolean;
	onToggle: () => void;
	empty: string;
	footer?: ReactNode;
	hold: ReturnType<ReturnType<typeof useSteadyOrder>["hold"]>;
	children: ReactNode[];
}) {
	const headingId = useId();
	if (collapsed)
		return (
			<button
				type="button"
				data-factory-group={id}
				data-factory-strip=""
				aria-expanded={false}
				aria-label={FACTORY_BOARD.showColumn(label, count)}
				title={FACTORY_BOARD.showColumn(label, count)}
				onClick={onToggle}
				className="flex w-9 shrink-0 snap-start flex-col items-center gap-2 rounded-lg border bg-muted/50 py-2.5 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-card dark:hover:bg-muted"
			>
				<ChevronRight aria-hidden className="size-3.5 shrink-0" />
				<span className="text-[12.5px] font-semibold [writing-mode:vertical-rl]">
					{label}
				</span>
				<span className="text-[11.5px] tabular-nums">{count}</span>
			</button>
		);
	return (
		<section
			aria-labelledby={headingId}
			data-factory-group={id}
			className="group/column flex min-h-0 min-w-[220px] max-w-[420px] flex-[1_1_0] snap-start flex-col overflow-hidden rounded-lg border bg-muted/50 dark:bg-card"
			{...hold}
		>
			<div className="flex h-9 shrink-0 items-center gap-[7px] px-2.5">
				<h2
					id={headingId}
					className="flex shrink-0 items-center gap-[7px] text-[13px] font-semibold"
				>
					<span
						aria-hidden
						className={cn("size-2 shrink-0 rounded-full", COLUMN_DOT[tone])}
					/>
					<span data-factory-column-title className="shrink-0">
						{label}
					</span>
					<span
						data-factory-count
						title={countTitle}
						className={cn(
							"shrink-0 tabular-nums",
							pill
								? "rounded-full bg-amber-500/15 px-1.5 text-[11px] leading-[17px] font-semibold text-warning-text"
								: "text-xs font-normal text-muted-foreground",
						)}
					>
						{count}
					</span>
				</h2>
				{aside}
				{collapsible ? (
					<button
						type="button"
						aria-expanded
						aria-label={FACTORY_BOARD.collapseColumn(label)}
						title={FACTORY_BOARD.collapseColumn(label)}
						onClick={onToggle}
						className={cn(
							"flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							aside ? "ml-1" : "ml-auto",
							// Shown on hover or focus, taking no room otherwise, so the
							// header's aside stays at its end.
							!alwaysShowCollapse &&
								"hidden group-focus-within/column:flex group-hover/column:flex [@media(hover:none)]:flex",
						)}
					>
						<ChevronLeft aria-hidden className="size-3.5" />
					</button>
				) : null}
			</div>
			<ul
				data-factory-list={id}
				className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1.5 pb-1.5 [scrollbar-width:thin]"
			>
				{children.length ? (
					children
				) : (
					<li
						data-factory-empty
						className="px-2 pt-3.5 text-center text-xs leading-normal text-muted-foreground"
					>
						{empty}
					</li>
				)}
			</ul>
			{footer ? (
				<p className="shrink-0 px-1.5 pt-1 pb-1.5 text-center text-[11.5px] text-muted-foreground">
					{footer}
				</p>
			) : null}
		</section>
	);
}

/** Whether an error message is raw structured output, such as a ZodError's. */
function factoryRawData(message: string): boolean {
	const text = message.trim();
	if (!/^[[{]/.test(text)) return false;
	try {
		JSON.parse(text);
		return true;
	} catch {
		return false;
	}
}

/** The first sentence of a stored error, for a one-line reason. */
function firstSentence(text: string): string {
	const line = text.trim().split("\n")[0]?.trim() ?? "";
	return /^(.+?[.!?])(?:\s|$)/.exec(line)?.[1] ?? line;
}

/**
 * Keeps a column's order while the pointer or focus is in it, so nothing
 * moves under the user; new items join at the end until they leave.
 */
function useSteadyOrder() {
	const orders = useRef(new Map<string, string[]>());
	const [held, setHeld] = useState<string | null>(null);
	const order = <T,>(key: string, items: T[], id: (item: T) => string): T[] => {
		const ids = items.map(id);
		const previous = orders.current.get(key);
		if (held !== key || !previous) {
			orders.current.set(key, ids);
			return items;
		}
		const byId = new Map(items.map((item) => [id(item), item]));
		const kept = previous.filter((value) => byId.has(value));
		const next = [...kept, ...ids.filter((value) => !kept.includes(value))];
		orders.current.set(key, next);
		return next.flatMap((value) => {
			const item = byId.get(value);
			return item === undefined ? [] : [item];
		});
	};
	const hold = (key: string) => ({
		onPointerEnter: () => setHeld(key),
		onPointerLeave: (event: { currentTarget: HTMLElement }) => {
			if (!event.currentTarget.contains(document.activeElement))
				setHeld((current) => (current === key ? null : current));
		},
		onFocus: () => setHeld(key),
		onBlur: (event: {
			currentTarget: HTMLElement;
			relatedTarget: EventTarget | null;
		}) => {
			if (
				!(event.relatedTarget instanceof Node) ||
				!event.currentTarget.contains(event.relatedTarget)
			)
				setHeld((current) => (current === key ? null : current));
		},
	});
	return { order, hold };
}

type FactoryViewProps = {
	drafts: Map<string, FactoryDraft>;
	onOpenSession: (
		sessionId: string,
		initialPromptDraft?: string,
	) => Promise<void>;
	/**
	 * A task chosen outside the Factory, such as from a notification or the
	 * sidebar; `FACTORY_ACTIVITY_REQUEST` asks for the home instead.
	 */
	requestedTaskId?: string;
	onRequestedTaskOpened?: () => void;
	/** Shows or hides Ask Factory, the one way to add work. */
	onAskFactory?: () => void;
	/** Whether the docked Ask Factory panel is showing (its buttons are toggles). */
	askFactoryOpen?: boolean;
	/** Opens a section of the app's own Settings (from Factory settings). */
	onOpenAppSettings?: (section: AppSettingsSection) => void;
	/** The card on screen, so Ask Factory can offer it as context. */
	onSelectedTaskChange?: (
		card: { taskId: string; shortId?: string } | null,
	) => void;
	/**
	 * Cards and attention the app already loads for the sidebar. Without it
	 * the view loads its own.
	 */
	board?: FactoryBoardData;
};

export function FactoryView({ board, ...props }: FactoryViewProps) {
	return board ? (
		<FactoryPage {...props} board={board} />
	) : (
		<SelfLoadingFactoryView {...props} />
	);
}

function SelfLoadingFactoryView(props: Omit<FactoryViewProps, "board">) {
	const agenda = useAgendaTasks(FACTORY_AGENDA_FILTERS);
	const attention = useFactoryAttention();
	return <FactoryPage {...props} board={{ agenda, attention }} />;
}

/**
 * What one delivery proves, in one line, from the data the board already
 * has: checks passed, the code review's result, and the user's own review or
 * feedback when they gave one. No rating is never mentioned: feedback is
 * optional.
 */
function deliveryProof(
	task: AgendaTaskRecord,
	outcome: FactoryAttention["outcome"] | undefined,
): string {
	if (!outcome) return "";
	const openFindings = factoryOpenFindings(task, outcome);
	const checks = task.factory?.checks?.length ?? 0;
	return [
		checks > 0 ? FACTORY_LINE.proof.checksPassed(checks) : undefined,
		openFindings
			? FACTORY_LINE.proof.findings(openFindings.findings.length)
			: outcome.phase === "ready" || outcome.phase === "watching"
				? FACTORY_LINE.proof.reviewPassed
				: undefined,
		outcome.humanApproval ? FACTORY_LINE.proof.reviewedByYou : undefined,
		outcome.audit?.reviewedAt
			? outcome.audit.finding
				? FACTORY_LINE.proof.flagged
				: FACTORY_LINE.proof.looksGood
			: undefined,
	]
		.filter(Boolean)
		.join(" · ");
}

function FactoryPage({
	drafts,
	onOpenSession,
	requestedTaskId,
	onRequestedTaskOpened,
	onAskFactory,
	askFactoryOpen,
	onOpenAppSettings,
	onSelectedTaskChange,
	board,
}: Omit<FactoryViewProps, "board"> & { board: FactoryBoardData }) {
	const { agenda, attention } = board;
	const tasks = agenda.tasks.filter((task) => task.factory);
	const tasksById = new Map(tasks.map((task) => [task.taskId, task]));
	const limits = useFactoryLimits();
	const [view, setView] = useState<FactoryDestination>(savedDestination);
	useEffect(() => {
		sessionStorage.setItem(DESTINATION_KEY, view);
	}, [view]);
	const showHistory = view === "history" || view === "archived";
	const currentAttention = factoryCurrentAttention(tasks, board);
	const boardTasks = tasks.filter(
		(task) =>
			!task.archivedAt &&
			task.status !== "cancelled" &&
			task.status !== "expired",
	);
	const now = new Date();
	const activities = new Map(
		boardTasks.map((task) => [
			task.taskId,
			factoryActivity(task, currentAttention.get(task.taskId), { now }),
		]),
	);
	const outcomes = new Map(
		[...currentAttention.values()].map((item) => [item.taskId, item.outcome]),
	);
	const finished = tasks.filter(
		(task) =>
			!task.archivedAt &&
			["completed", "failed", "cancelled", "expired"].includes(task.status),
	);
	const archived = tasks.filter((task) => task.archivedAt);
	const visibleOutcomes = view === "archived" ? archived : finished;
	const [selectedId, setSelectedId] = useState<string | null>(() =>
		typeof window === "undefined"
			? null
			: sessionStorage.getItem("factory.selectedTask"),
	);
	const [settingsFocus, setSettingsFocus] = useState<"dailyCostUsd">();
	// Back from settings returns focus to the header's Settings button.
	const returnToSettingsButton = useRef(false);
	useEffect(() => {
		if (view !== "activity" || !returnToSettingsButton.current) return;
		returnToSettingsButton.current = false;
		document.querySelector<HTMLElement>("[data-factory-settings]")?.focus();
	}, [view]);
	// A current Hub persists the pause beside the working limit and holds both
	// scoping and runs; an older Hub returns no `paused`, so the app stops the
	// queue and remembers the pause for this app session only.
	const hubPaused =
		limits.limits?.supported === true ? limits.limits.paused : undefined;
	const enginePause =
		limits.limits?.supported === true && typeof hubPaused === "boolean";
	// The value this view last set, until the Hub reports a newer one.
	const [pausedSet, setPausedSet] = useState<{
		over: unknown;
		paused: boolean;
	}>();
	const [sessionStopped, setSessionStopped] = useState(
		() =>
			typeof window !== "undefined" &&
			sessionStorage.getItem(QUEUE_STOPPED_KEY) === "true",
	);
	const queueStopped = enginePause
		? pausedSet && pausedSet.over === hubPaused
			? pausedSet.paused
			: hubPaused === true
		: sessionStopped;
	const markQueueStopped = (stopped: boolean) => {
		setSessionStopped(stopped);
		if (stopped) sessionStorage.setItem(QUEUE_STOPPED_KEY, "true");
		else sessionStorage.removeItem(QUEUE_STOPPED_KEY);
	};
	const setHubPaused = async (paused: boolean) => {
		const saved = await desktopClient.invoke<{ paused?: unknown }>(
			"factory_set_limits",
			{ paused },
		);
		setPausedSet({
			over: hubPaused,
			paused: typeof saved?.paused === "boolean" ? saved.paused : paused,
		});
	};
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const selected = tasks.find((task) => task.taskId === selectedId);
	const selectedTaskId = selected?.taskId;
	const selectedShortId = selected ? factoryShortId(selected) : undefined;
	useEffect(() => {
		onSelectedTaskChange?.(
			selectedTaskId
				? { taskId: selectedTaskId, shortId: selectedShortId }
				: null,
		);
	}, [onSelectedTaskChange, selectedTaskId, selectedShortId]);
	/** The card last opened, and which surface opened it, for focus return. */
	const lastOpened = useRef<{ id: string; source?: string } | null>(null);
	const { order, hold } = useSteadyOrder();
	// The board's width sets its tier; its grouping, columns and a person's
	// collapses are a saved view (factory-board-view.ts).
	const [boardRef, { width: boardWidth }] = useElementSize();
	const tier = factoryBoardTier(boardWidth);
	const [boardView, setBoardViewState] = useState(readFactoryBoardView);
	const setBoardView = (next: FactoryBoardView) => {
		setBoardViewState(next);
		saveFactoryBoardView(next);
	};
	const autoRetrying = (task: AgendaTaskRecord) =>
		Boolean(
			factoryOutcomeDetails(currentAttention.get(task.taskId)?.outcome)
				.autoRetrying,
		);
	// Every surface (the line, these columns, the rail and the app sidebar)
	// takes a card's station, column, label, colour and verb from
	// `factoryActivity`.
	const activityOf = (task: AgendaTaskRecord) =>
		activities.get(task.taskId) ?? factoryActivity(task, undefined, { now });
	const inColumn = (column: FactoryActivity["column"]) =>
		boardTasks.filter((task) => activityOf(task).column === column);
	// Approved work that is not running waits for the queue: held by Pause new
	// work, or manual work the Hub has not queued.
	const held = boardTasks.filter(
		(task) =>
			task.status === "approved" &&
			!currentFactoryConclusion(task) &&
			!autoRetrying(task) &&
			activityOf(task).column === "Queued",
	);
	const startable = (task: AgendaTaskRecord) =>
		!queueStopped &&
		task.factoryQueued !== "run" &&
		!isFactoryHandsOff(task.factory) &&
		held.includes(task);
	// Failed work whose plan is still approved runs again from its row; a
	// plan whose checks are at fault goes back to scoping. A plan Factory
	// already re-scoped without fixing needs Edit plan on the card.
	const retryable = (task: AgendaTaskRecord) =>
		task.status === "failed" &&
		(task.approvedRevision === task.revision || factoryPlanFault(task)) &&
		!factoryPlanFaultStopped(task) &&
		!currentFactoryConclusion(task) &&
		!autoRetrying(task);
	// Each card is listed once, in the first group that claims it: Needs you
	// (in factory_status' order: compareFactoryNeedsYou), Working (furthest
	// along first), Waiting (the engine's queue order), then Delivered. A
	// delivery that waits on the user is in Needs you only.
	const needsYou = boardTasks
		.filter((task) => factoryNeedsYou(activityOf(task)))
		.map((task) => ({ task, urgency: factoryUrgency(activityOf(task).label) }))
		.sort(compareFactoryNeedsYou)
		.map(({ task }) => task);
	const unavailable = inColumn("Status unavailable");
	const unreadableTasks = unavailable.filter(
		(task) => activityOf(task).unreadable !== undefined,
	);
	// Furthest along first; a split's parent, which runs nothing, after them.
	const workingNow = inColumn("Working").sort(
		(a, b) =>
			Number(Boolean(activityOf(a).split?.parent)) -
				Number(Boolean(activityOf(b).split?.parent)) ||
			FACTORY_STATIONS.indexOf(activityOf(b).station.station) -
				FACTORY_STATIONS.indexOf(activityOf(a).station.station),
	);
	// A card whose status is not loaded yet waits with the queue, unless it
	// was already delivered.
	// In the order the engine starts them; within a priority, cards it has
	// not queued (held, or not loaded yet) follow the ones it has.
	const waitingTasks = [
		...inColumn("Queued"),
		...unavailable.filter((task) => {
			const { unreadable, station } = activityOf(task);
			return unreadable === undefined && station.station !== "delivered";
		}),
	].sort((a, b) =>
		a.factoryQueuedAt && b.factoryQueuedAt
			? compareFactoryQueue(a, b)
			: compareFactoryPriority(a, b) ||
				Number(!a.factoryQueuedAt) - Number(!b.factoryQueuedAt),
	);
	// A split's parent tracks its parts beside running work; it holds no slot.
	const running = workingNow.filter(
		(task) => !activityOf(task).split?.parent,
	).length;
	const slotsFull = factorySlotsFull(running, limits.limits);
	// Who is working on each card right now: scoping and plan checks from the
	// card, build, test and review from the board's active sessions. One
	// live-activity subscription serves the home and the rail.
	const liveSessions = new Map<string, FactoryLiveSession[]>(
		workingNow.map((task) => [
			task.taskId,
			factoryLiveSessions(
				task,
				currentAttention.get(task.taskId)?.outcome?.activeSessions ?? [],
			),
		]),
	);
	const liveActivity = useFactoryLiveActivity(
		[...liveSessions.values()].flat().map((session) => session.sessionId),
	);
	/** Board rows leave out elapsed time (`compact`); home rows show it. */
	const liveLine = (
		task: AgendaTaskRecord,
		{
			compact = false,
			wrap = false,
			className,
		}: { compact?: boolean; wrap?: boolean; className?: string },
	) => {
		const sessions = liveSessions.get(task.taskId) ?? [];
		return sessions.length ? (
			<FactoryLiveLine
				sessions={sessions}
				activity={liveActivity}
				compact={compact}
				wrap={wrap}
				className={className}
			/>
		) : null;
	};
	const watchButton = (task: AgendaTaskRecord) => {
		const sessions = liveSessions.get(task.taskId) ?? [];
		return sessions.length ? (
			<FactoryWatchButton
				taskId={task.taskId}
				title={task.title}
				sessions={sessions}
				activity={liveActivity}
				onOpenSession={(sessionId) => onOpenSession(sessionId)}
				label={FACTORY_CARD_ACTION.watch}
			/>
		) : null;
	};
	/** The row label, saying when queued work waits only for a slot. */
	const rowLabel = (task: AgendaTaskRecord) => {
		const activity = activityOf(task);
		if (
			activity.column === "Queued" &&
			!activity.split?.waiting &&
			slotsFull &&
			factoryWaitingForSlot([task]) > 0
		)
			return FACTORY_ACTIVITY.waitingForSlot;
		return activity.label;
	};
	const listed = new Set([
		...needsYou,
		...unreadableTasks,
		...workingNow,
		...waitingTasks,
	]);
	/** Every delivery not listed above, newest first. */
	const delivered = boardTasks
		.filter((task) => {
			const { station } = activityOf(task);
			return (
				!listed.has(task) && station.station === "delivered" && !station.stopped
			);
		})
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
	const deliveredRecently = delivered.slice(0, DELIVERED_RECENTLY_LIMIT);
	const deliveredToday = delivered.filter(
		(task) => activityOf(task).station.deliveredToday,
	).length;
	// A delivery that arrives after the first render fades in, once; 0 marks
	// the ones already there.
	const deliveriesSeen = useRef<Map<string, number> | null>(null);
	const arrived = (task: AgendaTaskRecord) => {
		if (!deliveriesSeen.current) return false;
		const at = deliveriesSeen.current.get(task.taskId);
		return at === undefined || (at > 0 && Date.now() - at < ARRIVE_MS);
	};
	useEffect(() => {
		const known = deliveriesSeen.current;
		deliveriesSeen.current = new Map(
			delivered.map((task) => [
				task.taskId,
				known ? (known.get(task.taskId) ?? Date.now()) : 0,
			]),
		);
	});
	const selectTask = (id: string | null, source?: string) => {
		if (id) lastOpened.current = { id, source };
		setSelectedId(id);
		if (id) sessionStorage.setItem("factory.selectedTask", id);
		else sessionStorage.removeItem("factory.selectedTask");
	};
	useEffect(() => {
		if (!requestedTaskId) return;
		if (requestedTaskId === FACTORY_ACTIVITY_REQUEST) {
			setView("activity");
			setSelectedId(null);
			sessionStorage.removeItem("factory.selectedTask");
		} else {
			lastOpened.current = { id: requestedTaskId };
			setSelectedId(requestedTaskId);
			sessionStorage.setItem("factory.selectedTask", requestedTaskId);
		}
		onRequestedTaskOpened?.();
	}, [requestedTaskId, onRequestedTaskOpened]);
	// Coming back from a card returns focus to what opened it: the same chip
	// or row when it is still there, else any control for that card.
	useEffect(() => {
		if (selectedId || !lastOpened.current) return;
		const { id, source } = lastOpened.current;
		const targets = Array.from(
			document.querySelectorAll<HTMLElement>("[data-factory-task]"),
		).filter((item) => item.dataset.factoryTask === id);
		(
			targets.find((item) => item.dataset.factorySource === source) ??
			targets[0]
		)?.focus();
	}, [selectedId]);
	async function perform(action: () => Promise<void>) {
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			await action();
			await agenda.refresh();
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Couldn't update Factory. Try again.",
			);
		} finally {
			setBusy(false);
		}
	}
	const startTasks = (items: AgendaTaskRecord[], done: string) =>
		perform(async () => {
			await desktopClient.startFactoryQueue(items);
			setMessage(done);
		});
	const retryTask = (task: AgendaTaskRecord) =>
		factoryRetryPath(task) === "scope"
			? perform(async () => {
					await desktopClient.designFactoryTask(task.taskId);
					setMessage(
						`Sending “${task.title}” back to scoping: its checks need fixing.`,
					);
				})
			: startTasks([task], `Trying “${task.title}” again.`);
	const rescope = (task: AgendaTaskRecord) =>
		perform(async () => {
			await desktopClient.designFactoryTask(task.taskId);
			setMessage(`Scoping “${task.title}” again.`);
		});
	const loadingActivity =
		(agenda.isLoading && tasks.length === 0) ||
		(!attention.hasLoaded && attention.isLoading);
	const activityConfirmed =
		attention.hasLoaded &&
		attention.transportReady &&
		!attention.isLoading &&
		!agenda.isLoading &&
		!agenda.error &&
		!attention.error;
	const connectionProblem =
		agenda.error || attention.error || !attention.transportReady;
	const loadError = agenda.error || attention.error;
	// Validation output is logged, never shown: the page says what happened.
	const connectionMessage =
		loadError && attention.transportReady && factoryRawData(loadError)
			? FACTORY_UNREADABLE.page
			: FACTORY_MESSAGES.cantReach;
	useEffect(() => {
		if (loadError && factoryRawData(loadError))
			console.warn("Factory status could not be read", loadError);
	}, [loadError]);
	const notices = (
		<>
			{error || connectionProblem ? (
				<div
					role="alert"
					className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
				>
					<AlertTriangle className="size-4 shrink-0" />
					<span className="min-w-0 flex-1">
						{error ?? connectionMessage}
						{error && connectionProblem ? ` ${connectionMessage}` : ""}
						{loadError && !factoryRawData(loadError) ? (
							<span className="block text-xs text-destructive/80">
								{loadError}
							</span>
						) : null}
					</span>
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => {
							setError(null);
							void agenda.refresh();
							void attention.refresh();
						}}
					>
						<RefreshCw className="mr-1.5 size-3.5" />
						Retry
					</Button>
				</div>
			) : null}
			{message ? (
				<output className="mb-4 flex items-center gap-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
					<CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
					{message}
				</output>
			) : null}
		</>
	);
	const resumeDisabled =
		busy ||
		agenda.isLoading ||
		attention.isLoading ||
		!attention.transportReady;
	const resumeWork = () =>
		void perform(async () => {
			// The Hub kept its queue while paused and starts it on resume.
			if (enginePause) {
				await setHubPaused(false);
				return;
			}
			if (held.length > 0) await desktopClient.startFactoryQueue(held);
			markQueueStopped(false);
		});
	const pauseWork = () =>
		void perform(async () => {
			if (enginePause) {
				await setHubPaused(true);
				return;
			}
			await desktopClient.stopFactoryQueue();
			markQueueStopped(true);
		});
	const pausedMessage = FACTORY_MESSAGES.paused(running);
	/**
	 * The paused line beside an open card. `compact` fits the rail with
	 * titles: a short visible label, the full message for readers, and Resume.
	 */
	const pauseBanner = (compact = false) => (
		<output
			data-factory-paused={compact ? "rail" : "banner"}
			className={cn(
				"flex flex-wrap items-center gap-x-3 gap-y-2 text-sm",
				compact
					? "border-b px-3 py-2 text-xs"
					: "rounded-lg border bg-muted/30 px-4 py-3",
			)}
		>
			<Pause className="size-4 shrink-0 text-muted-foreground" />
			{compact ? (
				<span className="min-w-0 flex-1 truncate">
					<span aria-hidden>{FACTORY_COMPACT.paused}</span>
					<span className="sr-only">{pausedMessage}</span>
				</span>
			) : (
				<span className="min-w-0 flex-1">{pausedMessage}</span>
			)}
			<Button
				size={compact ? "xs" : "sm"}
				variant="outline"
				className="shrink-0"
				disabled={resumeDisabled}
				onClick={resumeWork}
			>
				{FACTORY_MESSAGES.resume}
			</Button>
		</output>
	);
	// Cards Factory filed for a recurring review pattern carry a badge.
	const ruleBadge = (task: AgendaTaskRecord) =>
		isFactoryRuleCard(task) || currentAttention.get(task.taskId)?.ruleCard ? (
			<FactoryRuleBadge />
		) : null;
	/** Where a card stopped, in its station's name. */
	const stoppedAt = (task: AgendaTaskRecord) =>
		FACTORY_LINE.stoppedAt(
			FACTORY_LINE.stations[activityOf(task).station.station],
		);
	const byId = (task: AgendaTaskRecord) => task.taskId;
	/**
	 * The home's status groups, in the board's order: each card once, in the
	 * first group that claims it. The rail beside a card lists the same.
	 */
	const homeGroups: [FactoryHomeGroup, string, AgendaTaskRecord[]][] = [
		["working", FACTORY_LINE.groups.working, workingNow],
		["waiting", FACTORY_LINE.groups.waiting, waitingTasks],
		[
			"needsYou",
			FACTORY_LINE.groups.needsYou,
			[...unreadableTasks, ...needsYou],
		],
		["delivered", FACTORY_LINE.groups.delivered, deliveredRecently],
	];
	if (selectedId) {
		// The same groups, in the same order, as the home: Working (running,
		// then the queue), Needs you, Delivered.
		const railSections = homeGroups
			.filter(([, , items]) => items.length > 0)
			.map(([group, label, items]) =>
				group === "waiting" && !boardView.queueColumn
					? ([FACTORY_BOARD.queue, items] as const)
					: ([label, items] as const),
			);
		// With any priority on the rail, every wide row keeps the icon's slot so
		// the titles stay aligned.
		const railPriority = railSections.some(([, items]) =>
			items.some((task) => hasFactoryPriority(task.factoryPriority)),
		);
		/** A rail row's state, as every other surface shows the card. */
		const railState = (task: AgendaTaskRecord) => {
			const activity = activityOf(task);
			const label = rowLabel(task);
			return {
				label,
				detail: activity.station.stopped
					? stoppedAt(task)
					: activity.column === "Working" && !activity.split?.parent
						? factoryWorkingDetail(
								FACTORY_LINE.stations[activity.station.station],
								activity.station.stage ??
									(activity.station.checks
										? FACTORY_LINE.runningChecks
										: label),
							)
						: label,
				tone: activity.tone,
				working: activity.column === "Working" && !activity.split?.parent,
			};
		};
		const railRow = (task: AgendaTaskRecord) => {
			const state = railState(task);
			const current = task.taskId === selectedId;
			const name = [factoryShortId(task), task.title].filter(Boolean).join(" ");
			return (
				<li key={task.taskId}>
					<button
						type="button"
						data-factory-task={task.taskId}
						data-factory-source="rail"
						aria-label={`${name}, ${state.label}`}
						aria-current={current ? "true" : undefined}
						title={task.title}
						onClick={() => selectTask(task.taskId, "rail")}
						className={cn(
							"flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring @max-[1119px]/factory:justify-center",
							current && "bg-muted",
						)}
					>
						{state.working ? (
							<Loader2
								aria-hidden
								className={cn("size-3 shrink-0", toneText(state.tone), SPIN)}
							/>
						) : (
							<span
								aria-hidden
								className={cn(
									"size-2 shrink-0 rounded-full",
									toneDot(state.tone),
								)}
							/>
						)}
						{/* Wide rail only: the icon rail has no room beside the id. */}
						{railPriority ? (
							<span className="hidden w-3.5 shrink-0 @min-[1120px]/factory:flex">
								<FactoryPriorityIcon priority={task.factoryPriority} />
							</span>
						) : null}
						<FactoryIdChip task={task} />
						<span className="hidden min-w-0 flex-1 @min-[1120px]/factory:block">
							<span className="block truncate text-sm">{task.title}</span>
							<span
								className={cn("block truncate text-xs", toneText(state.tone))}
							>
								{state.detail}
							</span>
						</span>
					</button>
					{state.working
						? liveLine(task, {
								compact: true,
								className: "hidden px-3 pb-2 pl-8 @min-[1120px]/factory:flex",
							})
						: null}
				</li>
			);
		};
		const railIcon =
			"size-8 @min-[1120px]/factory:size-auto @min-[1120px]/factory:px-2";
		return (
			<div
				className="@container/factory flex min-h-0 flex-1 flex-col"
				data-testid="factory-view"
			>
				<div
					data-factory-layout="master-detail"
					className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] @min-[960px]/factory:grid-cols-[4.5rem_minmax(0,1fr)] @min-[1120px]/factory:grid-cols-[16rem_minmax(0,1fr)]"
				>
					{/* Below 960px the card takes the page and Back returns to the list. */}
					<nav
						aria-label={FACTORY_MASTER_DETAIL.rail}
						data-factory-rail
						className="hidden min-h-0 flex-col border-r @min-[960px]/factory:flex"
					>
						<div className="flex flex-col items-center gap-1 border-b px-2 py-2 @min-[1120px]/factory:flex-row">
							<Button
								variant="ghost"
								size="sm"
								className={railIcon}
								aria-label={FACTORY_MASTER_DETAIL.allActivity}
								title={FACTORY_MASTER_DETAIL.allActivity}
								onClick={() => selectTask(null)}
							>
								<FactoryIcon className="size-4" />
								<span className="hidden @min-[1120px]/factory:inline">
									Factory
								</span>
							</Button>
							<span className="hidden flex-1 @min-[1120px]/factory:block" />
							{onAskFactory ? (
								<Button
									variant="ghost"
									size="icon"
									className="size-8"
									aria-label={FACTORY_MANAGER.ask}
									aria-expanded={askFactoryOpen}
									data-ask-factory=""
									title={FACTORY_MANAGER.ask}
									onClick={onAskFactory}
								>
									<MessageSquare className="size-4" />
								</Button>
							) : null}
						</div>
						{queueStopped ? (
							<>
								<div className="hidden @min-[1120px]/factory:block">
									{pauseBanner(true)}
								</div>
								{/* The id rail is too narrow for Resume: an indicator here,
								    and the full banner beside the card. */}
								<span
									role="img"
									data-factory-paused="indicator"
									aria-label={FACTORY_COMPACT.pausedIndicator}
									title={FACTORY_COMPACT.pausedIndicator}
									className="flex justify-center border-b py-2 text-muted-foreground @min-[1120px]/factory:hidden"
								>
									<Pause aria-hidden className="size-4" />
								</span>
							</>
						) : null}
						{/* A block viewport lets rail titles truncate instead of
						    widening the rail past its column. */}
						<ScrollArea
							className="min-h-0 flex-1"
							viewportClassName={PAGE_FRAME_FIT_VIEWPORT}
						>
							<div className="pb-4">
								{railSections.map(([label, items]) => (
									<section key={label} aria-label={label} className="pt-2">
										<h2 className="hidden items-center gap-2 px-3 pb-1 text-xs font-medium text-muted-foreground @min-[1120px]/factory:flex">
											{label}
											<span className="tabular-nums">{items.length}</span>
										</h2>
										<div
											aria-hidden
											className="mx-3 mb-1 border-t @min-[1120px]/factory:hidden"
										/>
										<ul>{items.map(railRow)}</ul>
									</section>
								))}
							</div>
						</ScrollArea>
					</nav>
					<div className="min-h-0 min-w-0">
						<PageFrame key={selectedId} fit contentClassName="max-w-none">
							{queueStopped ? (
								<div className="mb-4 @min-[1120px]/factory:hidden">
									{pauseBanner()}
								</div>
							) : null}
							{notices}
							{selected ? (
								<FactoryCardBoundary
									key={selected.taskId}
									onBack={() => selectTask(null)}
								>
									<FeatureDetail
										drafts={drafts}
										task={selected}
										onRefresh={agenda.refresh}
										onOpenSession={onOpenSession}
										onOpenTask={selectTask}
										onClose={() => selectTask(null)}
										questions={
											currentAttention.get(selected.taskId)?.questions ?? []
										}
										onAnswer={attention.answer}
										unreadable={activityOf(selected).unreadable}
										limits={limits.limits}
										split={factorySplitContext(selected, {
											tasks: tasksById,
											links: factoryAttentionLinks(
												currentAttention.get(selected.taskId),
											),
											card: (other) => ({
												activity:
													activities.get(other.taskId) ??
													factoryActivity(
														other,
														currentAttention.get(other.taskId),
														{ now },
													),
												pullRequestUrl: factoryOutcomeDetails(
													outcomes.get(other.taskId),
												).pullRequestUrl,
												pullRequestOutcome: outcomes.get(other.taskId)
													?.pullRequestOutcome,
											}),
										})}
									/>
								</FactoryCardBoundary>
							) : agenda.isLoading ? (
								<output className="block text-sm text-muted-foreground">
									{FACTORY_MESSAGES.loading}
								</output>
							) : (
								<PageEmptyState className="flex flex-col items-center gap-3 py-8 text-center">
									<p>{FACTORY_MESSAGES.notFound}</p>
									<Button
										size="sm"
										variant="outline"
										onClick={() => selectTask(null)}
									>
										<ArrowLeft className="mr-1.5 size-3.5" />
										Back to Factory
									</Button>
								</PageEmptyState>
							)}
						</PageFrame>
					</div>
				</div>
			</div>
		);
	}
	const backToActivity = (
		<Button
			variant="ghost"
			size="sm"
			className="-ml-2 mb-3"
			onClick={() => setView("activity")}
		>
			<ArrowLeft className="mr-1.5 size-3.5" />
			Back to Factory
		</Button>
	);
	const nothingAtAll =
		activityConfirmed && tasks.filter((task) => !task.archivedAt).length === 0;
	// A figure the Hub does not report is left out rather than guessed.
	const supportedLimits = limits.limits?.supported ? limits.limits : undefined;
	const spent = supportedLimits?.spentTodayUsd;
	const dailyLimit = supportedLimits?.dailyCostUsd;
	const limitReached =
		typeof dailyLimit === "number" &&
		spent !== undefined &&
		spent >= dailyLimit;
	const spendText =
		spent === undefined
			? undefined
			: FACTORY_LINE.spend(
					formatFactoryUsd(spent),
					typeof dailyLimit === "number"
						? formatFactoryUsd(dailyLimit)
						: undefined,
				);
	// Only an exception gets a banner: one slim line under the header, one
	// sentence and at most one link. Resume is the header's toggle.
	const bannerRow =
		"flex min-h-8 shrink-0 items-center gap-2 border-b px-4 py-1.5 text-[12.5px]";
	const banners = (
		<>
			{error || connectionProblem ? (
				<div
					role="alert"
					className={cn(bannerRow, "bg-destructive/5 text-error-text")}
				>
					<AlertTriangle aria-hidden className="size-3.5 shrink-0" />
					<span className="min-w-0 flex-1 truncate">
						{error ?? connectionMessage}
						{error && connectionProblem ? ` ${connectionMessage}` : ""}
						{loadError && !factoryRawData(loadError) ? ` ${loadError}` : ""}
					</span>
					<Button
						variant="link"
						size="sm"
						className="h-auto shrink-0 p-0 text-xs text-accent-foreground"
						disabled={busy}
						onClick={() => {
							setError(null);
							void agenda.refresh();
							void attention.refresh();
						}}
					>
						<RefreshCw aria-hidden className="size-3" />
						Retry
					</Button>
				</div>
			) : null}
			{message ? (
				<output className={cn(bannerRow, "bg-muted/30")}>
					<CheckCircle2
						aria-hidden
						className={cn("size-3.5 shrink-0", toneText("success"))}
					/>
					<span className="min-w-0 flex-1 truncate">{message}</span>
				</output>
			) : null}
			{view !== "activity" ? null : limitReached ? (
				<output
					data-factory-banner="limit"
					className={cn(bannerRow, "bg-amber-500/10")}
				>
					<AlertTriangle
						aria-hidden
						className={cn("size-3.5 shrink-0", toneText("attention"))}
					/>
					<span className="min-w-0 truncate">
						{FACTORY_LINE.limitReached(
							formatFactoryUsd(spent ?? 0),
							formatFactoryUsd(dailyLimit ?? 0),
						)}
					</span>
					<Button
						variant="link"
						size="sm"
						className="h-auto shrink-0 p-0 text-[12.5px] text-accent-foreground"
						onClick={() => {
							setSettingsFocus("dailyCostUsd");
							setView("settings");
						}}
					>
						{FACTORY_LINE.changeLimit}
					</Button>
				</output>
			) : queueStopped ? (
				<output
					data-factory-banner="paused"
					className={cn(bannerRow, "bg-amber-500/10")}
				>
					<Pause
						aria-hidden
						className={cn("size-3.5 shrink-0", toneText("attention"))}
					/>
					<span className="min-w-0 flex-1 truncate">
						{FACTORY_BOARD.paused}
					</span>
				</output>
			) : null}
			{view === "activity" ? (
				<FactoryHandsOffNotice className="min-h-8 shrink-0 rounded-none border-0 border-b px-4 py-1 text-[12.5px] [&_p]:truncate [&_svg]:size-3.5 [&_button]:h-6" />
			) : null}
		</>
	);

	/** Why a card stopped, in one line of plain words. */
	const stopReason = (task: AgendaTaskRecord) => {
		if (factoryPlanFaultStopped(task)) return FACTORY_RECOVERY.planFaultStopped;
		if (factoryPlanFault(task)) return FACTORY_RECOVERY.planFault;
		if (factoryScopingStopped(task))
			return factoryScopingStopReason(task.error);
		const repairLimit = factoryRepairLimitReason(task.error);
		if (repairLimit) return repairLimit;
		const publish = factoryPublishFailureReason(task.error);
		if (publish !== undefined)
			return [FACTORY_RECOVERY.publishFailed, publish]
				.filter(Boolean)
				.join(": ");
		const text = firstSentence(
			task.error && !factoryRawData(task.error) ? task.error : "",
		);
		// Failed checks stop the card at Build: say so, unless the error does.
		if (
			activityOf(task).station.checks &&
			!text.startsWith(FACTORY_LINE.checksFailed)
		)
			return [FACTORY_LINE.checksFailed, text].filter(Boolean).join(": ");
		return text || stoppedAt(task);
	};
	/** What a decision asks, in one line. */
	const decisionDetail = (task: AgendaTaskRecord) => {
		const activity = activityOf(task);
		if (activity.split?.unmerged) return activity.split.unmerged;
		const breakdown =
			task.factoryDesignProgress?.revision === task.revision
				? task.factoryDesignProgress.split
				: undefined;
		if (breakdown) return FACTORY_SPLIT.approvalTitle(breakdown.parts.length);
		const outcome = outcomes.get(task.taskId);
		const openFindings = factoryOpenFindings(task, outcome);
		const review = factoryOutcomeDetails(outcome).humanReview;
		if (activity.label === FACTORY_DECISION.question) {
			const question =
				currentAttention.get(task.taskId)?.questions[0]?.question ??
				task.factoryQuestions?.find(
					(item) =>
						item.status === "pending" && item.revision === task.revision,
				)?.question;
			if (question) return FACTORY_LINE.question(question);
		}
		if (activity.label === FACTORY_DECISION.rule)
			return (
				factoryProposedRule({ taskId: task.taskId, outcome })?.summary ??
				activity.label
			);
		if (openFindings)
			return FACTORY_OPEN_FINDINGS.headline(openFindings.findings.length);
		if (activity.label === FACTORY_READY.needsReview && review) {
			// Mid-sentence elsewhere; here it starts the card's line.
			const reason = factoryReviewReason(review.reason);
			return reason.charAt(0).toUpperCase() + reason.slice(1);
		}
		return (
			(task.factory &&
				factoryAutoApprovalBlocker({ ...task, factory: task.factory })) ||
			// The card's first row names the repository.
			activity.label
		);
	};
	/**
	 * A card's one quick action: shown on hover or keyboard focus, in the DOM
	 * always so Tab and assistive technology reach it.
	 */
	const quickAction = (
		task: AgendaTaskRecord,
		label: string,
		Icon: typeof RotateCcw,
		run: () => void,
		disabled = false,
	) => (
		<Button
			size="xs"
			variant="outline"
			aria-label={`${label}: ${task.title}`}
			disabled={disabled}
			onClick={run}
			title={label}
			className="h-[22px] gap-1 bg-background px-2 text-[11.5px] shadow-none dark:bg-[var(--neutral-4)]"
		>
			<Icon aria-hidden className="size-3" />
			<span aria-hidden data-label>
				{label}
			</span>
		</Button>
	);
	/**
	 * A stop's quick action, only when the engine will run again: Try again
	 * (a repair limit gets one more round from a person's retry) or Try
	 * scoping again. A plan repair limit needs Edit plan, on the card.
	 */
	const stopAction = (task: AgendaTaskRecord): ReactNode => {
		if (PLAN_REPAIR_LIMIT.test(task.error ?? "")) return null;
		if (factoryScopingStopped(task))
			return quickAction(
				task,
				FACTORY_CARD_ACTION.tryScopingAgain,
				RotateCcw,
				() => void rescope(task),
				busy || !activityConfirmed,
			);
		if (retryable(task))
			return quickAction(
				task,
				FACTORY_CARD_ACTION.tryAgain,
				RotateCcw,
				() => void retryTask(task),
				busy || !activityConfirmed,
			);
		return null;
	};
	// The repository shows on cards only when they span more than one, and
	// never in the Project grouping, whose columns name it.
	const projectOf = (task: AgendaTaskRecord) =>
		basenamePath(task.workspaceRoot);
	const showProject =
		boardView.grouping !== "project" &&
		new Set(boardTasks.map(projectOf)).size > 1;

	/**
	 * One card of the board, three rows: id · repository and the stage (or
	 * age); the title, four lines at most (two in the queue); an icon, up to
	 * three lines (the live line two, its height kept) and a time. The whole
	 * card is one button that opens it. The one quick action sits at the end
	 * of the first row, shown on hover or focus: the repository gives way to
	 * it, so it never covers the stage, the title or the reason.
	 */
	const boardCard = (
		task: AgendaTaskRecord,
		group: FactoryHomeGroup,
		{
			icon,
			detail,
			detailTitle,
			live = false,
			queued = false,
			time,
			stages = false,
			end,
			edge,
		}: {
			icon?: ReactNode;
			detail?: ReactNode;
			/** The context line's full text, as its tooltip (a string detail is its own). */
			detailTitle?: string;
			/** The detail is the live line: two lines, height kept as it changes. */
			live?: boolean;
			/** A queued card: its title takes two lines at most. */
			queued?: boolean;
			time?: ReactNode;
			stages?: boolean;
			/** Row 1's right end when there is no stage: the age. */
			end?: ReactNode;
			edge?: "danger" | "attention";
		},
		action?: ReactNode,
	) => {
		const activity = activityOf(task);
		const id = factoryShortId(task);
		const name = [id, task.title].filter(Boolean).join(" ");
		const state = activity.station.stopped ? stoppedAt(task) : rowLabel(task);
		const parent = task.factoryParentTaskId
			? tasksById.get(task.factoryParentTaskId)
			: undefined;
		// Grouped by stage, the column names the stage: no stepper on the card.
		const stepper = stages && boardView.grouping !== "stage";
		return (
			<li
				key={task.taskId}
				data-factory-row={group}
				data-factory-card={task.taskId}
				className={cn(
					"group/card @container/card relative flex flex-none flex-col gap-[3px] rounded-md border bg-background px-[9px] pt-[7px] pb-2 transition-colors hover:border-foreground/20 hover:bg-[var(--neutral-2)] dark:bg-[var(--neutral-3)] dark:hover:bg-[var(--neutral-4)]",
					edge === "danger" &&
						"shadow-[inset_2px_0_0_var(--color-destructive)]",
					edge === "attention" &&
						"shadow-[inset_2px_0_0_var(--color-amber-500)]",
					group === "delivered" && arrived(task) && ARRIVE,
				)}
			>
				<button
					type="button"
					data-factory-task={task.taskId}
					data-factory-source={group}
					aria-label={`${name}, ${state}`}
					title={task.title}
					onClick={() => selectTask(task.taskId, group)}
					className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
				<div
					data-factory-card-top
					className="flex h-[15px] min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground"
				>
					{hasFactoryPriority(task.factoryPriority) ? (
						// Above the card's button so its tooltip shows; a click
						// still opens the card, which keyboard users reach directly.
						// biome-ignore lint/a11y/noStaticElementInteractions: pointer pass-through to the card's button
						// biome-ignore lint/a11y/useKeyWithClickEvents: the card's button carries the keyboard
						<span
							className="relative z-10 flex"
							onClick={() => selectTask(task.taskId, group)}
						>
							<FactoryPriorityIcon priority={task.factoryPriority} />
						</span>
					) : null}
					{id ? (
						<span
							data-factory-id
							className="shrink-0 font-mono text-[10.5px] tracking-[0.02em]"
						>
							{id}
						</span>
					) : null}
					{parent ? (
						// Above the card's button, as the priority icon is.
						<FactoryParentLink
							compact
							parent={{
								taskId: parent.taskId,
								shortId: factoryShortId(parent),
								title: parent.title,
							}}
							onOpen={(taskId) => selectTask(taskId, group)}
							className="relative z-10 shrink-0"
						/>
					) : null}
					{showProject && activity.unreadable === undefined ? (
						<span
							data-factory-project
							title={projectOf(task)}
							// Hidden on a card under 200px (its content under 182px).
							className="min-w-0 truncate @max-[181px]/card:hidden"
						>
							{id ? "· " : ""}
							{projectOf(task)}
						</span>
					) : null}
					<span className="ml-auto flex shrink-0 items-center tabular-nums">
						{stepper ? (
							<FactoryRowStages
								state={activity.station}
								// A decision is amber at its stage; a stop is red.
								tone={
									edge === "danger"
										? "danger"
										: edge === "attention"
											? "attention"
											: activity.tone
								}
								className="gap-[5px] text-[11px]"
							/>
						) : (
							end
						)}
					</span>
					{action ? (
						// In the row's flow, so it pushes nothing it could cover; no
						// width until hover or focus (still reachable by Tab).
						<div
							data-factory-quick-action
							className="relative z-10 -my-1 flex max-w-0 shrink-0 overflow-hidden opacity-0 transition-opacity group-focus-within/card:max-w-none group-focus-within/card:overflow-visible group-focus-within/card:opacity-100 group-hover/card:max-w-none group-hover/card:overflow-visible group-hover/card:opacity-100 [@media(hover:none)]:max-w-none [@media(hover:none)]:opacity-100 @max-[239px]/card:[&_[data-label]]:hidden"
						>
							{action}
						</div>
					) : null}
				</div>
				<p
					className={cn(
						"break-words text-[13px] leading-[17px] font-medium",
						queued ? "line-clamp-2" : "line-clamp-4",
					)}
				>
					{task.title}
					{ruleBadge(task) ? (
						<span className="ml-1.5 inline-flex align-middle">
							{ruleBadge(task)}
						</span>
					) : null}
				</p>
				{detail ? (
					<div
						data-factory-detail
						className="flex min-w-0 items-start gap-1.5 text-xs leading-4 text-muted-foreground"
					>
						{icon ? (
							<span aria-hidden className="mt-0.5 flex shrink-0">
								{icon}
							</span>
						) : null}
						<span
							data-factory-context
							title={
								detailTitle ?? (typeof detail === "string" ? detail : undefined)
							}
							className={cn(
								"min-w-0 flex-1 break-words",
								// The live line clamps itself to two lines; its two
								// lines' height stays so cards below do not move.
								live ? "min-h-8" : "line-clamp-3",
							)}
						>
							{detail}
						</span>
						{time ? (
							<span className="ml-auto shrink-0 text-[11px] tabular-nums">
								{time}
							</span>
						) : null}
					</div>
				) : null}
			</li>
		);
	};

	const needsYouRow = (task: AgendaTaskRecord) => {
		const activity = activityOf(task);
		// A card whose stored data failed validation: its id and the reason,
		// so every other card still shows.
		if (activity.unreadable !== undefined)
			return boardCard(task, "needsYou", {
				icon: <AlertTriangle className={cn("size-3", toneText("attention"))} />,
				// The raw reason is under Details on the card page.
				detail: FACTORY_UNREADABLE.card,
				edge: "attention",
			});
		const stopped = STOPPED_LABELS.has(activity.label);
		const Icon = stopped
			? XCircle
			: activity.label === FACTORY_DECISION.question
				? HelpCircle
				: factoryDecisionStyle(activity.label).icon;
		return boardCard(
			task,
			"needsYou",
			{
				icon: (
					<Icon
						className={cn("size-3", toneText(stopped ? "danger" : "attention"))}
					/>
				),
				detail: stopped ? (
					<span data-factory-stop-reason>{stopReason(task)}</span>
				) : (
					decisionDetail(task)
				),
				detailTitle: stopped ? stopReason(task) : undefined,
				time: formatRelativeTime(task.updatedAt),
				stages: true,
				edge: stopped ? "danger" : "attention",
			},
			stopped ? stopAction(task) : null,
		);
	};

	const workingRow = (task: AgendaTaskRecord) => {
		const activity = activityOf(task);
		// A parent only tracks its parts: one quiet line, no stepper or timer.
		if (activity.split?.parent)
			return boardCard(task, "working", {
				icon: <ListTree className="size-3" />,
				detail: activity.label,
			});
		const live =
			activity.station.stage || activity.station.checks
				? null
				: liveLine(task, { compact: true, wrap: true, className: "text-xs" });
		const watch = watchButton(task);
		const startedAt = (liveSessions.get(task.taskId) ?? [])
			.map((session) => Date.parse(session.startedAt ?? ""))
			.filter(Number.isFinite)
			.sort((a, b) => a - b)[0];
		return boardCard(
			task,
			"working",
			{
				icon: (
					<Loader2 className={cn("size-3", toneText(activity.tone), SPIN)} />
				),
				// The stepper already says Build: a repository stage shows by its
				// name, the plan's checks as "Running checks".
				detail: activity.station.stage
					? activity.station.stage
					: activity.station.checks
						? FACTORY_LINE.runningChecks
						: (live ?? rowLabel(task)),
				live: Boolean(live),
				time:
					startedAt === undefined ? undefined : (
						<BoardElapsed since={startedAt} />
					),
				stages: true,
			},
			// The shared watch control, sized as a quick action.
			watch ? (
				<span className="flex [&_button]:h-[22px] [&_button]:gap-1 [&_button]:bg-background [&_button]:px-2 [&_button]:text-[11.5px] [&_button]:shadow-none dark:[&_button]:bg-[var(--neutral-4)] [&_svg]:size-3">
					{watch}
				</span>
			) : null,
		);
	};

	const waitingRow = (task: AgendaTaskRecord) => {
		const label = rowLabel(task);
		// While paused the banner says why cards wait, not each card.
		const detail =
			queueStopped && label === FACTORY_ACTIVITY.waitingForSlot
				? undefined
				: label;
		return boardCard(
			task,
			"waiting",
			{
				icon: detail ? <Clock className="size-3" /> : undefined,
				detail,
				queued: true,
			},
			startable(task)
				? quickAction(
						task,
						FACTORY_RECOVERY.start,
						Play,
						() => void startTasks([task], `Starting “${task.title}”.`),
						busy || !activityConfirmed,
					)
				: null,
		);
	};

	const deliveredRow = (task: AgendaTaskRecord) => {
		const activity = activityOf(task);
		if (activity.split?.parent)
			return boardCard(task, "delivered", {
				icon: <ListTree className={cn("size-3", toneText("success"))} />,
				detail: activity.label,
				end: formatRelativeTime(task.updatedAt),
			});
		const outcome = outcomes.get(task.taskId);
		const url =
			factoryOutcomeDetails(outcome).pullRequestUrl ??
			factoryOpenFindings(task, outcome)?.pullRequestUrl;
		const Icon = url ? GitPullRequest : GitBranch;
		// Feedback never stops a card: a delivery the person flagged stays
		// delivered, with their note as its quiet last line.
		const flagged = outcome?.audit?.finding;
		const proof = [
			// Without its outcome, the muted "Status not loaded yet".
			outcome ? deliveryProof(task, outcome) : activity.label,
			url
				? FACTORY_BOARD.pullRequest(
						outcome?.pullRequestOutcome,
						outcome?.pullRequestReady === true,
					)
				: FACTORY_LINE.proof.onBranch,
		]
			.filter(Boolean)
			.join(" · ");
		return boardCard(
			task,
			"delivered",
			{
				icon: flagged ? (
					<Flag className="size-3" />
				) : (
					<Icon className={cn("size-3", toneText("success"))} />
				),
				detail: flagged ? (
					<span data-factory-flagged>{FACTORY_LINE.flagged(flagged)}</span>
				) : (
					<span data-factory-proof>{proof}</span>
				),
				detailTitle: flagged ? FACTORY_LINE.flagged(flagged) : proof,
				end: formatRelativeTime(task.updatedAt),
			},
			url
				? quickAction(
						task,
						factoryPullRequestActionLabel(outcome),
						ExternalLink,
						() => void openExternalUrl(url),
					)
				: null,
		);
	};

	const cardFor: Record<
		FactoryHomeGroup,
		(task: AgendaTaskRecord) => ReactNode
	> = {
		needsYou: needsYouRow,
		working: workingRow,
		waiting: waitingRow,
		delivered: deliveredRow,
	};
	// Every card the board lists, once, with its status group; a grouping
	// turns them into columns.
	const statusOf = new Map<string, FactoryHomeGroup>();
	const boardRows: FactoryBoardRow[] = [];
	const taskById = new Map<string, AgendaTaskRecord>();
	for (const [group, , items] of homeGroups)
		for (const task of items) {
			statusOf.set(task.taskId, group);
			taskById.set(task.taskId, task);
			boardRows.push({
				id: task.taskId,
				status: group,
				stage: activityOf(task).station.station,
				project: projectOf(task),
			});
		}
	const columns = resolveFactoryBoard(boardView, boardRows);
	const historyColumnShown = columns.some(
		(column) => column.id === "delivered" && !column.hidden,
	);
	const allHistory = (
		<Button
			variant="link"
			size="sm"
			className="ml-auto h-auto shrink-0 px-0 py-1 text-xs font-normal text-accent-foreground"
			onClick={() => setView("history")}
		>
			{FACTORY_LINE.allHistory}
		</Button>
	);
	const skeletons = [0, 1, 2].map((index) => (
		<li key={`skeleton-${index}`} aria-hidden>
			<Skeleton className="h-[62px] rounded-md" />
		</li>
	));
	// The board's first column carries the empty board's one instruction.
	const firstColumnId = columns.find((column) => !column.hidden)?.id;
	const emptyLine = (id: string) =>
		id === firstColumnId && nothingAtAll
			? FACTORY_BOARD.empty.nothing
			: boardView.grouping === "status" && id in FACTORY_BOARD.empty
				? FACTORY_BOARD.empty[id as FactoryHomeGroup]
				: FACTORY_BOARD.empty.column;
	const cardOf = (task: AgendaTaskRecord) =>
		cardFor[statusOf.get(task.taskId) ?? "waiting"](task);
	const boardColumn = (column: FactoryBoardResolvedColumn) => {
		const pinned = factoryBoardPinned(boardView.grouping, column.id);
		// An empty board keeps every column open: its one instruction must show.
		const collapsed =
			!nothingAtAll && factoryBoardCollapsed(boardView, column, tier);
		const key = `${boardView.grouping}:${column.id}`;
		const tasksOf = (rows: readonly FactoryBoardRow[]) =>
			rows.flatMap((row) => taskById.get(row.id) ?? []);
		const inSection = new Set(
			column.sections.flatMap((section) => section.rows.map((row) => row.id)),
		);
		// Main cards (running, in Working), then each section under a divider.
		const items = order(
			key,
			tasksOf(column.rows.filter((row) => !inSection.has(row.id))),
			byId,
		);
		const sections = column.sections
			.filter((section) => section.rows.length > 0)
			.map((section) => {
				const all = order(`${key}:${section.id}`, tasksOf(section.rows), byId);
				return { ...section, all, shown: all.slice(0, WAITING_LIMIT) };
			});
		const queued = sections.reduce(
			(sum, section) => sum + section.all.length,
			0,
		);
		const shown =
			column.id === "waiting" ? items.slice(0, WAITING_LIMIT) : items;
		const hiddenWaiting =
			items.length -
			shown.length +
			sections.reduce(
				(sum, section) => sum + section.all.length - section.shown.length,
				0,
			);
		const isStatus = boardView.grouping === "status";
		const footer =
			hiddenWaiting > 0
				? FACTORY_BOARD.moreWaiting(hiddenWaiting)
				: column.id === "delivered" &&
						delivered.length > deliveredRecently.length
					? FACTORY_BOARD.mostRecent(deliveredRecently.length)
					: undefined;
		const working = isStatus && column.id === "working";
		const cards =
			loadingActivity && column.rows.length === 0
				? skeletons
				: [
						...shown.map(cardOf),
						...sections.flatMap((section) => [
							<li
								key={`section-${section.id}`}
								data-factory-section={section.id}
								className="flex items-center gap-2 px-1 pt-2 pb-0.5 text-[11px] text-muted-foreground"
							>
								<span>{section.title}</span>
								<span className="tabular-nums">{section.all.length}</span>
								<span aria-hidden className="h-px flex-1 bg-border" />
							</li>,
							...section.shown.map(cardOf),
						]),
					];
		return (
			<BoardColumn
				key={column.id}
				id={column.id}
				label={column.title}
				tone={
					isStatus && column.id === "needsYou" && items.length === 0
						? "neutral"
						: (column.tone ?? "neutral")
				}
				// Working counts what runs (not a split's parent); its queue is
				// counted after the limit.
				count={
					working
						? items.filter((task) => !activityOf(task).split?.parent).length
						: items.length + queued
				}
				pill={isStatus && column.id === "needsYou" && items.length > 0}
				countTitle={
					column.id === "delivered"
						? FACTORY_LINE.deliveredToday(deliveredToday)
						: undefined
				}
				aside={
					working ? (
						<>
							<FactoryWorkingLimit
								running={running}
								state={limits}
								className={slotsFull ? toneText("attention") : undefined}
							/>
							{queued > 0 ? (
								<span
									data-factory-queued
									className="min-w-0 truncate text-xs text-muted-foreground"
								>
									· {FACTORY_BOARD.queued(queued)}
								</span>
							) : null}
						</>
					) : column.id === "delivered" ? (
						allHistory
					) : null
				}
				collapsed={collapsed}
				collapsible={!pinned}
				alwaysShowCollapse={
					!nothingAtAll &&
					factoryBoardAutoCollapsed(boardView, tier).has(column.id)
				}
				onToggle={() =>
					setBoardView(
						collapseFactoryBoardColumn(
							boardView,
							columns,
							tier,
							column.id,
							!collapsed,
						),
					)
				}
				empty={emptyLine(column.id)}
				footer={footer}
				hold={hold(key)}
			>
				{cards}
			</BoardColumn>
		);
	};
	const pauseLabel = queueStopped
		? FACTORY_MESSAGES.resume
		: FACTORY_MESSAGES.pauseNewWork;
	const compactHeader = tier !== "wide";
	const header = (
		<header className="flex h-12 shrink-0 items-center gap-2 border-b pr-3 pl-4">
			<h1 className="flex min-w-0 items-center gap-2 text-[15px] font-semibold">
				<FactoryIcon
					aria-hidden
					className="size-[17px] shrink-0 text-primary"
				/>
				Factory
			</h1>
			<Badge
				variant="outline"
				className="h-4 px-1.5 text-[10.5px] font-medium text-muted-foreground"
			>
				Preview
			</Badge>
			<span className="flex-1" />
			{view === "activity" && spendText && !nothingAtAll && tier !== "tight" ? (
				<span
					data-factory-spend
					className="px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
				>
					{spendText}
				</span>
			) : null}
			{view === "activity" ? (
				<BoardDisplayMenu
					view={boardView}
					columns={columns}
					onChange={setBoardView}
					onAllHistory={
						historyColumnShown ? undefined : () => setView("history")
					}
				/>
			) : null}
			{/* One toggle, one place: Pause new work, or Resume. */}
			{view === "activity" && (queueStopped || !nothingAtAll) ? (
				<Button
					variant="ghost"
					size="sm"
					data-factory-pause={queueStopped ? "resume" : "pause"}
					aria-label={pauseLabel}
					disabled={queueStopped ? resumeDisabled : busy}
					title={
						queueStopped
							? pauseLabel
							: "Stop starting queued work. Work that is already running continues."
					}
					onClick={queueStopped ? resumeWork : pauseWork}
					className={cn("h-7", compactHeader ? "w-7 px-0" : "px-2")}
				>
					{queueStopped ? (
						<Play aria-hidden className="size-3.5" />
					) : (
						<Pause aria-hidden className="size-3.5" />
					)}
					{compactHeader ? null : <span aria-hidden>{pauseLabel}</span>}
				</Button>
			) : null}
			<Button
				variant="ghost"
				size="sm"
				aria-label={FACTORY_TERMS.settings}
				title={FACTORY_TERMS.settings}
				data-factory-settings
				onClick={() => setView("settings")}
				className={cn("h-7", compactHeader ? "w-7 px-0" : "px-2")}
			>
				<Settings aria-hidden className="size-3.5" />
				{compactHeader ? null : (
					<span aria-hidden>{FACTORY_COMPACT.settings}</span>
				)}
			</Button>
			{/* One way in: the manager chat adds work as well as answering. */}
			{onAskFactory ? (
				<Button
					size="sm"
					variant={askFactoryOpen ? "secondary" : "default"}
					aria-expanded={askFactoryOpen}
					data-ask-factory=""
					onClick={onAskFactory}
					className={cn("h-7 px-2.5", askFactoryOpen && "border")}
				>
					<MessageSquare aria-hidden className="size-3.5" />
					{FACTORY_MANAGER.ask}
				</Button>
			) : null}
		</header>
	);

	if (view === "settings")
		return (
			<div
				ref={boardRef}
				className="@container/factory flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
				data-testid="factory-view"
			>
				<FactorySettingsPage
					onBack={() => {
						setSettingsFocus(undefined);
						returnToSettingsButton.current = true;
						setView("activity");
					}}
					onAskFactory={onAskFactory}
					askFactoryOpen={askFactoryOpen}
					limits={limits}
					focus={settingsFocus}
					onOpenAppSettings={onOpenAppSettings}
					onOpenArchive={() => {
						setSettingsFocus(undefined);
						setView("archived");
					}}
					onOpenCard={(taskId) => {
						setSettingsFocus(undefined);
						setView("activity");
						selectTask(taskId, "settings");
					}}
					onNewWork={() => {
						setSettingsFocus(undefined);
						setView("activity");
						if (!askFactoryOpen) onAskFactory?.();
					}}
					projects={[
						...new Set(
							tasks
								.filter((task) => !task.archivedAt && task.workspaceRoot)
								.map((task) => task.workspaceRoot as string),
						),
					]}
				/>
			</div>
		);
	return (
		<div
			ref={boardRef}
			className="@container/factory flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
			data-testid="factory-view"
		>
			{header}
			{banners}
			{view === "activity" ? (
				<section
					aria-label={FACTORY_BOARD.board}
					data-factory-home
					data-factory-grouping={boardView.grouping}
					data-factory-tier={tier}
					className="flex min-h-0 flex-1 snap-x snap-proximity gap-2 overflow-x-auto overflow-y-hidden p-2"
				>
					{loadingActivity ? (
						<output className="sr-only">{FACTORY_MESSAGES.loading}</output>
					) : null}
					{columns.filter((column) => !column.hidden).map(boardColumn)}
				</section>
			) : (
				<div className="min-h-0 flex-1">
					<PageFrame key={view} fit>
						{showHistory ? (
							<div className="pb-6">
								{backToActivity}
								<div className="mb-4 flex flex-wrap items-center gap-1.5">
									{(
										[
											["history", `Finished (${finished.length})`],
											["archived", `Archived (${archived.length})`],
										] satisfies [FactoryDestination, string][]
									).map(([destination, label]) => (
										<Button
											type="button"
											size="xs"
											key={destination}
											aria-pressed={view === destination}
											variant={view === destination ? "default" : "outline"}
											onClick={() => setView(destination)}
										>
											{label}
										</Button>
									))}
								</div>
								<p className="mb-3 text-xs text-muted-foreground">
									{view === "archived"
										? "Archived work. Open an item to restore or delete it."
										: "Everything Factory finished, including failures."}
								</p>
								{visibleOutcomes.length > 0 ? (
									<div className="overflow-x-auto rounded-lg border bg-card">
										<table className="w-full text-left text-sm">
											<thead>
												<tr className="border-b bg-muted/40 text-xs text-muted-foreground">
													<th className="px-4 py-2 font-medium">Work</th>
													<th className="px-4 py-2 font-medium">
														{view === "archived" ? "Status" : "Outcome"}
													</th>
													{view === "archived" ? (
														<th className="px-4 py-2 font-medium">Archived</th>
													) : (
														<>
															<th className="hidden px-4 py-2 text-right font-medium @min-[720px]/page:table-cell">
																Cost
															</th>
															<th className="hidden px-4 py-2 text-right font-medium @min-[720px]/page:table-cell">
																Review fixes
															</th>
															<th className="px-4 py-2 font-medium">
																{FACTORY_TERMS.feedback}
															</th>
														</>
													)}
												</tr>
											</thead>
											<tbody className="divide-y">
												{visibleOutcomes.map((task) => {
													const outcome = outcomes.get(task.taskId);
													const status = factoryHistoryStatus({
														status: task.status,
														phase:
															view === "archived" ? undefined : outcome?.phase,
														reviewed:
															view !== "archived" &&
															Boolean(outcome?.humanApproval),
														openFindings: factoryOpenFindings(task, outcome)
															?.findings.length,
													});
													const tone: FactoryTone =
														status === FACTORY_ACTIVITY.reviewed
															? "success"
															: factoryOpenFindings(task, outcome)
																? "attention"
																: task.status === "failed" ||
																		outcome?.phase === "blocked"
																	? "danger"
																	: task.status === "completed"
																		? "accent"
																		: "neutral";
													return (
														<tr
															key={task.taskId}
															className="transition-colors hover:bg-muted/30"
														>
															<td className="px-4 py-2.5">
																<button
																	type="button"
																	data-factory-task={task.taskId}
																	className="rounded-sm text-left font-medium hover:underline hover:underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
																	onClick={() => selectTask(task.taskId)}
																>
																	<FactoryIdChip
																		task={task}
																		className="inline-block align-middle"
																	/>{" "}
																	{task.title}
																</button>
																{ruleBadge(task) ? (
																	<span className="ml-2 inline-flex align-middle">
																		{ruleBadge(task)}
																	</span>
																) : null}
																<span className="block text-xs text-muted-foreground">
																	{basenamePath(task.workspaceRoot)}
																</span>
															</td>
															<td className="px-4 py-2.5">
																<StatusPill tone={tone}>{status}</StatusPill>
															</td>
															{view === "archived" ? (
																<td className="px-4 py-2.5 text-muted-foreground">
																	{task.archivedAt
																		? new Date(task.archivedAt).toLocaleString()
																		: "—"}
																</td>
															) : (
																<>
																	<td className="hidden px-4 py-2.5 text-right tabular-nums @min-[720px]/page:table-cell">
																		{outcome?.usage
																			? `$${outcome.usage.totals.totalCost.toFixed(2)}${outcome.usage.unknownSessionIds.length ? " + unknown" : ""}`
																			: "—"}
																	</td>
																	<td className="hidden px-4 py-2.5 text-right tabular-nums @min-[720px]/page:table-cell">
																		{outcome?.repairRound ?? "—"}
																	</td>
																	<td className="px-4 py-2.5 text-muted-foreground">
																		{outcome
																			? (factoryFeedbackLabel(outcome.audit) ??
																				"—")
																			: FACTORY_ACTIVITY.statusNotLoaded}
																	</td>
																</>
															)}
														</tr>
													);
												})}
											</tbody>
										</table>
									</div>
								) : (
									<PageEmptyState className="flex flex-col items-center gap-3 py-8 text-center">
										<CircleDashed className="size-6" />
										{view === "archived"
											? "No archived work."
											: !attention.hasLoaded || attention.error || agenda.error
												? "Results aren't loaded yet. Use Retry above."
												: "Nothing finished yet."}
									</PageEmptyState>
								)}
							</div>
						) : null}
					</PageFrame>
				</div>
			)}
		</div>
	);
}

/** Elapsed time on a Working card, coarse ("4m"), kept current. */
function BoardElapsed({ since }: { since: number }) {
	const now = useFactoryNow(true);
	return <>{formatFactoryDuration(now - since)}</>;
}

/**
 * The board's Display menu, as Linear's and GitHub Projects' view options:
 * group by, which columns show, their order, and back to the default.
 */
function BoardDisplayMenu({
	view,
	columns,
	onChange,
	onAllHistory,
}: {
	view: FactoryBoardView;
	columns: FactoryBoardResolvedColumn[];
	onChange: (view: FactoryBoardView) => void;
	/** All history, when no Delivered column on the board carries it. */
	onAllHistory?: () => void;
}) {
	// The columns section renders from the view's columns; Other is not one.
	const listed = columns.filter(
		(column) => column.id !== FACTORY_BOARD_OTHER_ID,
	);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					aria-label={FACTORY_BOARD.display}
					title={FACTORY_BOARD.display}
					data-factory-display
					className="h-7 w-7 px-0"
				>
					<SlidersHorizontal aria-hidden className="size-3.5" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="max-h-[min(32rem,var(--radix-dropdown-menu-content-available-height))] w-60 overflow-y-auto"
			>
				<DropdownMenuLabel className="text-xs text-muted-foreground">
					{FACTORY_BOARD.groupBy}
				</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={view.grouping}
					onValueChange={(value) =>
						onChange(groupFactoryBoard(view, value as FactoryBoardGrouping))
					}
				>
					{(Object.keys(FACTORY_BOARD_GROUPINGS) as FactoryBoardGrouping[]).map(
						(grouping) => (
							<DropdownMenuRadioItem key={grouping} value={grouping}>
								{FACTORY_BOARD_GROUPINGS[grouping].label}
							</DropdownMenuRadioItem>
						),
					)}
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				<DropdownMenuLabel className="text-xs text-muted-foreground">
					{FACTORY_BOARD.columns}
				</DropdownMenuLabel>
				{listed.map((column) => (
					<DropdownMenuCheckboxItem
						key={column.id}
						checked={!column.hidden}
						disabled={factoryBoardPinned(view.grouping, column.id)}
						onSelect={(event) => event.preventDefault()}
						onCheckedChange={() =>
							onChange(toggleFactoryBoardColumn(view, columns, column.id))
						}
					>
						{column.title}
					</DropdownMenuCheckboxItem>
				))}
				{view.grouping === "status" ? (
					<DropdownMenuCheckboxItem
						data-factory-queue-column
						checked={view.queueColumn === true}
						onSelect={(event) => event.preventDefault()}
						onCheckedChange={(checked) =>
							onChange(setFactoryBoardQueueColumn(view, checked === true))
						}
					>
						{FACTORY_BOARD.queueColumn}
					</DropdownMenuCheckboxItem>
				) : null}
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>
						{FACTORY_BOARD.reorder}
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="max-h-80 overflow-y-auto">
						{listed.flatMap((column, index) => [
							<DropdownMenuItem
								key={`${column.id}-left`}
								disabled={index === 0}
								onSelect={(event) => {
									event.preventDefault();
									onChange(
										moveFactoryBoardColumn(view, columns, column.id, -1),
									);
								}}
							>
								<ArrowLeft aria-hidden className="size-3.5" />
								{FACTORY_BOARD.moveLeft(column.title)}
							</DropdownMenuItem>,
							<DropdownMenuItem
								key={`${column.id}-right`}
								disabled={index === listed.length - 1}
								onSelect={(event) => {
									event.preventDefault();
									onChange(moveFactoryBoardColumn(view, columns, column.id, 1));
								}}
							>
								<ArrowRight aria-hidden className="size-3.5" />
								{FACTORY_BOARD.moveRight(column.title)}
							</DropdownMenuItem>,
						])}
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuSeparator />
				{onAllHistory ? (
					<DropdownMenuItem onSelect={onAllHistory}>
						{FACTORY_LINE.allHistory}
					</DropdownMenuItem>
				) : null}
				<DropdownMenuItem onSelect={() => onChange(DEFAULT_FACTORY_BOARD_VIEW)}>
					<RotateCcw aria-hidden className="size-3.5" />
					{FACTORY_BOARD.reset}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

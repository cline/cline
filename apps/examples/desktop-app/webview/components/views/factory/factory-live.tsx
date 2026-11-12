"use client";

import type { AgendaTaskRecord, FactoryAttempt } from "@cline/shared";
import { ArrowLeft, ArrowUpRight, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	type FactoryLiveActivity,
	type FactoryLiveEntry,
	useFactoryNow,
} from "@/hooks/use-factory-live-activity";
import { FACTORY_ROLE_LABEL } from "@/lib/factory-copy";
import { cn } from "@/lib/utils";

export type FactoryLiveRole =
	| "designer"
	| "plan_reviewer"
	| "builder"
	| "verifier"
	| "reviewer";

/** A role session Factory is running now. */
export type FactoryLiveSession = {
	sessionId: string;
	role: FactoryLiveRole;
	/** ISO time the session's work started, for elapsed time. */
	startedAt?: string;
	/** ISO time the session finished, when the run recorded it. */
	endedAt?: string;
	/** The model the session ran on, when the run recorded it. */
	model?: string;
	/** A repository stage's name ("Security scan"), shown instead of the role. */
	stage?: string;
};

export const FACTORY_ROLE_LABELS: Record<FactoryLiveRole, string> = {
	designer: FACTORY_ROLE_LABEL.designer,
	plan_reviewer: FACTORY_ROLE_LABEL.planReviewer,
	builder: FACTORY_ROLE_LABEL.builder,
	verifier: FACTORY_ROLE_LABEL.verifier,
	reviewer: FACTORY_ROLE_LABEL.reviewer,
};

/** Execution attempts still running, oldest first. */
export function activeFactorySessions(
	attempts: readonly FactoryAttempt[] | undefined,
): FactoryLiveSession[] {
	return (attempts ?? [])
		.filter(
			(attempt) => attempt.status === "intent" || attempt.status === "running",
		)
		.map((attempt) => ({
			sessionId: attempt.sessionId,
			role: attempt.role,
			startedAt: attempt.createdAt,
		}));
}

/**
 * The sessions working on a card right now: running execution attempts
 * (from the run, or the board's `outcome.activeSessions`), else the scoping
 * agent or the plan checkers still reviewing the current revision.
 */
export function factoryLiveSessions(
	task: Pick<
		AgendaTaskRecord,
		| "status"
		| "revision"
		| "updatedAt"
		| "archivedAt"
		| "error"
		| "factoryDesignProgress"
	>,
	active: readonly FactoryLiveSession[] = [],
): FactoryLiveSession[] {
	if (task.archivedAt) return [];
	if (task.status === "in_progress" || task.status === "completed")
		return [...active];
	const progress = task.factoryDesignProgress;
	if (
		task.error ||
		!progress ||
		progress.revision !== task.revision ||
		(task.status !== "pending_approval" && task.status !== "approved")
	)
		return [];
	if (progress.phase === "designing")
		return [
			{
				sessionId: progress.designerSessionId,
				role: "designer",
				startedAt: task.updatedAt,
			},
		];
	if (progress.phase !== "reviewing") return [];
	const done = new Set(progress.reviews.map((review) => review.reviewerIndex));
	const latest = new Map<number, string>();
	for (const reviewer of progress.reviewerSessions)
		latest.set(reviewer.reviewerIndex, reviewer.sessionId);
	return [...latest]
		.filter(([index]) => !done.has(index))
		.map(([, sessionId]) => ({
			sessionId,
			role: "plan_reviewer" as const,
			startedAt: task.updatedAt,
		}));
}

/** "45s", "4m 12s", "1h 3m". */
export function formatFactoryElapsed(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Coarse duration for one-line summaries: "45s", "4m", "1h 3m". */
export function formatFactoryDuration(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Role names, numbered only when a role runs more than once. */
function sessionLabels(sessions: readonly FactoryLiveSession[]) {
	const totals = new Map<FactoryLiveRole, number>();
	for (const session of sessions)
		if (!session.stage)
			totals.set(session.role, (totals.get(session.role) ?? 0) + 1);
	const seen = new Map<FactoryLiveRole, number>();
	return new Map(
		sessions.map((session) => {
			// A repository stage's session is named by its stage.
			if (session.stage) return [session.sessionId, session.stage];
			const index = (seen.get(session.role) ?? 0) + 1;
			seen.set(session.role, index);
			const label = FACTORY_ROLE_LABELS[session.role];
			return [
				session.sessionId,
				(totals.get(session.role) ?? 0) > 1 ? `${label} ${index}` : label,
			];
		}),
	);
}

/** The most recently active session, then the oldest. */
function primarySession(
	sessions: readonly FactoryLiveSession[],
	entries: ReadonlyMap<string, FactoryLiveEntry> | undefined,
) {
	let best = sessions[0];
	let bestAt = -1;
	for (const session of sessions) {
		const at = entries?.get(session.sessionId)?.at ?? -1;
		if (at > bestAt) {
			best = session;
			bestAt = at;
		}
	}
	return best;
}

/** Repeats `value` at most every `ms`, so screen readers are not flooded. */
function useThrottled(value: string, ms: number) {
	const [shown, setShown] = useState(value);
	const last = useRef(0);
	useEffect(() => {
		const wait = last.current + ms - Date.now();
		if (wait <= 0) {
			last.current = Date.now();
			setShown(value);
			return;
		}
		const timer = window.setTimeout(() => {
			last.current = Date.now();
			setShown(value);
		}, wait);
		return () => window.clearTimeout(timer);
	}, [value, ms]);
	return shown;
}

/**
 * One muted line: "Builder · Reading src/api/routes.ts · 4m 12s". Without
 * live events it falls back to the role and elapsed time.
 */
export function FactoryLiveLine({
	sessions,
	activity,
	waiting,
	compact = false,
	showOthers = true,
	className,
}: {
	sessions: readonly FactoryLiveSession[];
	/** From `useFactoryLiveActivity`; omit to show role and elapsed time only. */
	activity?: FactoryLiveActivity;
	/** Shown when nothing runs yet, e.g. "Waiting for a free slot". */
	waiting?: string;
	/** Board rows: no elapsed time. */
	compact?: boolean;
	/**
	 * Off on a card, whose Agents tab lists every agent: the line names only
	 * the most recently active one, without "+N more".
	 */
	showOthers?: boolean;
	className?: string;
}) {
	const primary = primarySession(sessions, activity?.sessions);
	const entry = primary ? activity?.sessions.get(primary.sessionId) : undefined;
	const now = useFactoryNow(Boolean(primary) && !compact);
	const labels = sessionLabels(sessions);
	const role = primary ? (labels.get(primary.sessionId) ?? "") : "";
	const startedAt = primary?.startedAt ? Date.parse(primary.startedAt) : NaN;
	const others = showOthers ? sessions.length - 1 : 0;
	const reconnecting = Boolean(primary) && activity?.connected === false;
	const text = !primary
		? (waiting ?? "")
		: reconnecting
			? "Live activity paused: reconnecting"
			: entry?.ended
				? `${role} finished`
				: [role, entry?.lastTool ?? "Working"].join(" · ");
	const announced = useThrottled(text, 5000);
	if (!text) return null;
	const elapsed =
		!primary || reconnecting || compact
			? undefined
			: entry?.ended
				? `${formatFactoryElapsed(now - entry.at)} ago`
				: Number.isFinite(startedAt)
					? formatFactoryElapsed(now - startedAt)
					: undefined;
	return (
		<p
			data-testid="factory-live-line"
			className={cn(
				"flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground",
				className,
			)}
		>
			<span className="min-w-0 truncate" aria-hidden>
				{text}
			</span>
			{others > 0 && !reconnecting ? (
				<span className="shrink-0" aria-hidden>
					· +{others} more
				</span>
			) : null}
			{elapsed ? (
				<span className="shrink-0 tabular-nums" aria-hidden>
					· {elapsed}
				</span>
			) : null}
			<output aria-live="polite" className="sr-only">
				{announced}
				{others > 0 && !reconnecting ? `, and ${others} more` : ""}
			</output>
		</p>
	);
}

const WATCH_ORIGIN_KEY = "factory.watchOrigin";

/** Remembers which card opened a session so the chat view can link back. */
export function rememberFactoryWatchOrigin(origin: {
	sessionId: string;
	taskId: string;
	title: string;
}) {
	try {
		sessionStorage.setItem(WATCH_ORIGIN_KEY, JSON.stringify(origin));
	} catch {
		// Storage is best effort; app Back still works.
	}
}

export function readFactoryWatchOrigin(
	sessionId: string | undefined,
): { taskId: string; title: string } | undefined {
	if (!sessionId || typeof window === "undefined") return undefined;
	try {
		const value = JSON.parse(
			sessionStorage.getItem(WATCH_ORIGIN_KEY) ?? "null",
		) as Record<string, unknown> | null;
		return value?.sessionId === sessionId &&
			typeof value.taskId === "string" &&
			typeof value.title === "string"
			? { taskId: value.taskId, title: value.title }
			: undefined;
	} catch {
		return undefined;
	}
}

/** "← Back to ‹card›" above a session that was opened from Factory. */
export function FactoryBackChip({
	sessionId,
	onOpenFactoryTask,
}: {
	sessionId: string | undefined;
	onOpenFactoryTask: (taskId: string) => void;
}) {
	const origin = readFactoryWatchOrigin(sessionId);
	if (!origin) return null;
	return (
		<div className="flex-none px-4 pt-2">
			<Button
				variant="outline"
				size="sm"
				className="h-7 max-w-full rounded-full px-3 text-xs"
				onClick={() => onOpenFactoryTask(origin.taskId)}
			>
				<ArrowLeft className="mr-1 size-3.5 shrink-0" />
				<span className="truncate">Back to {origin.title}</span>
			</Button>
		</div>
	);
}

/**
 * "Watch live" for a card's running sessions: one button, or a menu when
 * several run in parallel. Ended sessions offer their transcript instead;
 * sessions that fail to open are dropped with a short note.
 */
export function FactoryWatchButton({
	taskId,
	title,
	sessions,
	activity,
	onOpenSession,
	label: watchLabel = "Watch live",
}: {
	taskId: string;
	title: string;
	sessions: readonly FactoryLiveSession[];
	activity?: FactoryLiveActivity;
	/** Rejects when the session cannot be opened. */
	onOpenSession: (sessionId: string) => Promise<void>;
	/** The button's text while a session runs (a board card says "Watch"). */
	label?: string;
}) {
	const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set());
	const available = sessions.filter(
		(session) => !missing.has(session.sessionId),
	);
	const labels = sessionLabels(sessions);
	if (!available.length)
		return missing.size && sessions.length ? (
			<p className="text-xs text-muted-foreground">
				This session is no longer available.
			</p>
		) : null;
	const open = (sessionId: string) => {
		rememberFactoryWatchOrigin({ sessionId, taskId, title });
		void onOpenSession(sessionId).catch(() =>
			setMissing((current) => new Set([...current, sessionId])),
		);
	};
	const ended = available.every(
		(session) => activity?.sessions.get(session.sessionId)?.ended,
	);
	const label = ended ? "Open session" : watchLabel;
	const primary = primarySession(available, activity?.sessions);
	const primaryLabel = primary ? labels.get(primary.sessionId) : undefined;
	// Named with the agent and card: a board shows one per working card.
	const trigger = (
		<Button
			variant="outline"
			size="sm"
			className="shrink-0"
			aria-label={`${ended ? "Open" : "Watch"} ${
				available.length > 1 ? "agents" : (primaryLabel ?? "agent")
			} on ${title}`}
			onClick={
				available.length > 1 || !primary
					? undefined
					: () => open(primary.sessionId)
			}
		>
			{label}
			{available.length > 1 ? (
				<ChevronDown className="ml-1 size-3.5" />
			) : (
				<ArrowUpRight className="ml-1 size-3.5" />
			)}
		</Button>
	);
	const notice = missing.size ? (
		<p className="text-xs text-muted-foreground">
			This session is no longer available.
		</p>
	) : null;
	if (available.length === 1)
		return (
			<div className="flex shrink-0 flex-col items-end gap-1">
				{trigger}
				{notice}
			</div>
		);
	return (
		<div className="flex shrink-0 flex-col items-end gap-1">
			<DropdownMenu>
				<DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="max-w-80">
					{available.map((session) => {
						const entry = activity?.sessions.get(session.sessionId);
						return (
							<DropdownMenuItem
								key={session.sessionId}
								onSelect={() => open(session.sessionId)}
							>
								<span className="truncate">
									{labels.get(session.sessionId)}
									{entry?.ended
										? " · finished"
										: entry?.lastTool
											? ` · ${entry.lastTool}`
											: ""}
								</span>
							</DropdownMenuItem>
						);
					})}
				</DropdownMenuContent>
			</DropdownMenu>
			{notice}
		</div>
	);
}

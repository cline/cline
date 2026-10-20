"use client";

import {
	AlertCircle,
	Check,
	ChevronDown,
	ChevronRight,
	CircleSlash,
	Clock3,
	FileSearch,
	Lightbulb,
	Loader2,
	MessagesSquare,
	Pencil,
	SquareTerminal,
	Users,
} from "lucide-react";
import { memo, useEffect, useState } from "react";
import {
	isTeamSettled,
	phaseBucket,
	summarizeTeam,
	type TeamMemberActivity,
	type TeamMemberPhase,
} from "@/lib/team-activity";
import { cn } from "@/lib/utils";

const PHASE_LABEL: Record<TeamMemberPhase, string> = {
	thinking: "Thinking",
	reading: "Reading",
	editing: "Editing",
	running: "Running",
	coordinating: "Coordinating",
	waiting: "Waiting",
	done: "Done",
	failed: "Failed",
	stopped: "Stopped",
};

const PHASE_ICON: Record<TeamMemberPhase, typeof Check> = {
	thinking: Lightbulb,
	reading: FileSearch,
	editing: Pencil,
	running: SquareTerminal,
	coordinating: MessagesSquare,
	waiting: Clock3,
	done: Check,
	failed: AlertCircle,
	stopped: CircleSlash,
};

function formatElapsed(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	const minutes = Math.floor(seconds / 60);
	if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
	return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

/** Re-renders once a second while anything is still running, for live timers. */
function useNow(active: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		setNow(Date.now());
		if (!active) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [active]);
	return now;
}

/**
 * Live view of an agent team, attached to the top of the chat input in the
 * slot the pull request bar uses. One row per teammate says what it is doing
 * right now, so planning, building, and coordinating are visible at a glance;
 * selecting a row opens that teammate's session. Once every teammate has
 * finished, the panel folds to a one-line summary.
 */
function TeamPanelImpl({
	teamName,
	members,
	activeSessionId,
	onOpenSession,
}: {
	teamName?: string;
	members: TeamMemberActivity[];
	/** The teammate session on screen, highlighted in the list. */
	activeSessionId?: string | null;
	onOpenSession: (sessionId: string) => void;
}) {
	const settled = isTeamSettled(members);
	const now = useNow(!settled && members.length > 0);
	const [open, setOpen] = useState(!settled);
	useEffect(() => {
		setOpen(!settled);
	}, [settled]);

	if (members.length === 0) return null;
	const startedAt = Math.min(...members.map((member) => member.startedAt));
	const endedAt = settled
		? Math.max(...members.map((member) => member.endedAt ?? now))
		: now;

	return (
		<section
			aria-label="Agent team"
			className="border-b border-border/70 text-xs"
			id="team-panel"
		>
			<button
				aria-expanded={open}
				className="flex w-full min-w-0 items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-surface-hover/60"
				onClick={() => setOpen((value) => !value)}
				type="button"
			>
				<Users
					aria-hidden="true"
					className="size-3.5 shrink-0 text-muted-foreground"
				/>
				<span className="shrink-0 font-medium text-foreground">Team</span>
				{teamName ? (
					<span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
						{teamName}
					</span>
				) : null}
				<span className="ml-auto shrink-0 text-muted-foreground">
					{summarizeTeam(members)}
				</span>
				<span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/80">
					{formatElapsed(endedAt - startedAt)}
				</span>
				<ChevronDown
					aria-hidden="true"
					className={cn(
						"size-3.5 shrink-0 text-muted-foreground transition-transform",
						!open && "-rotate-90",
					)}
				/>
			</button>
			{open ? (
				<ul className="max-h-52 overflow-y-auto overscroll-contain pb-1.5">
					{members.map((member) => (
						<TeamPanelRow
							active={member.sessionId === activeSessionId}
							key={member.agentId}
							member={member}
							now={now}
							onOpen={() => onOpenSession(member.sessionId)}
						/>
					))}
				</ul>
			) : null}
		</section>
	);
}

export const TeamPanel = memo(TeamPanelImpl);

function TeamPanelRow({
	member,
	now,
	active,
	onOpen,
}: {
	member: TeamMemberActivity;
	now: number;
	active: boolean;
	onOpen: () => void;
}) {
	const { phase } = member;
	const bucket = phaseBucket(phase);
	const PhaseIcon = PHASE_ICON[phase];
	const working = bucket === "planning" || bucket === "acting";
	const detail = phase === "done" ? member.task : (member.step ?? member.task);

	return (
		<li>
			<button
				aria-current={active || undefined}
				className={cn(
					"grid w-full grid-cols-[0.875rem_minmax(0,8rem)_6.5rem_minmax(0,1fr)_3.5rem_0.875rem] items-center gap-2 px-4 py-1 text-left transition-colors hover:bg-surface-hover",
					active && "bg-surface-hover",
				)}
				onClick={onOpen}
				title={
					member.task ? `${member.agentId}: ${member.task}` : member.agentId
				}
				type="button"
			>
				{working ? (
					<Loader2
						aria-hidden="true"
						className={cn(
							"size-3.5 animate-spin",
							bucket === "acting" ? "text-foreground" : "text-muted-foreground",
						)}
					/>
				) : bucket === "done" ? (
					<Check aria-hidden="true" className="size-3.5 text-chart-2" />
				) : bucket === "failed" ? (
					<AlertCircle
						aria-hidden="true"
						className="size-3.5 text-destructive"
					/>
				) : (
					<Clock3
						aria-hidden="true"
						className="size-3.5 text-muted-foreground"
					/>
				)}
				<span className="truncate font-medium text-foreground">
					{member.agentId}
				</span>
				<span
					className={cn(
						"flex min-w-0 items-center gap-1",
						bucket === "done"
							? "text-chart-2"
							: bucket === "failed"
								? "text-destructive"
								: bucket === "acting"
									? "text-foreground"
									: "text-muted-foreground",
					)}
				>
					<PhaseIcon aria-hidden="true" className="size-3 shrink-0" />
					<span className="truncate">{PHASE_LABEL[phase]}</span>
				</span>
				<span
					className={cn(
						"truncate text-muted-foreground",
						phase === "waiting" && "italic",
					)}
				>
					{detail}
				</span>
				<span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground/80">
					{formatElapsed((member.endedAt ?? now) - member.startedAt)}
				</span>
				<ChevronRight
					aria-hidden="true"
					className="size-3.5 text-muted-foreground/60"
				/>
			</button>
		</li>
	);
}

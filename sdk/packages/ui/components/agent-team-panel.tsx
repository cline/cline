"use client";

import { clsx } from "clsx";
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
	type AgentTeamMember,
	type AgentTeamMemberPhase,
	agentTeamPhaseBucket,
	isAgentTeamSettled,
	summarizeAgentTeam,
} from "./agent-team-activity.js";

export type AgentTeamPanelProps = {
	teamName?: string;
	members: readonly AgentTeamMember[];
	/** The teammate session on screen, highlighted in the list. */
	activeSessionId?: string | null;
	onOpenSession: (sessionId: string) => void;
	/**
	 * Clock for elapsed times, in epoch ms. Omit to tick every second while any
	 * teammate is still working; pass it to drive the panel from outside.
	 */
	now?: number;
	className?: string;
};

const PHASE_LABEL: Record<AgentTeamMemberPhase, string> = {
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

const PHASE_ICON: Record<AgentTeamMemberPhase, typeof Check> = {
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

export function formatAgentTeamElapsed(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	const minutes = Math.floor(seconds / 60);
	if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
	return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

/** Re-renders once a second while `active`, for live timers. */
function useTickingNow(active: boolean, fixed: number | undefined): number {
	const [now, setNow] = useState(() => fixed ?? Date.now());
	useEffect(() => {
		if (fixed !== undefined) return;
		setNow(Date.now());
		if (!active) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [active, fixed]);
	return fixed ?? now;
}

/**
 * Live view of an agent team, made to sit at the top of the chat composer in
 * the slot the pull request bar uses. One row per teammate says what it is
 * doing right now, so planning, building, and coordinating are visible at a
 * glance; selecting a row opens that teammate's session. Once every teammate
 * has finished the panel folds to a one-line summary, and it opens again if
 * the team resumes.
 */
function AgentTeamPanelImpl({
	teamName,
	members,
	activeSessionId,
	onOpenSession,
	now: fixedNow,
	className,
}: AgentTeamPanelProps) {
	const settled = isAgentTeamSettled(members);
	const now = useTickingNow(!settled && members.length > 0, fixedNow);
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
			className={clsx(
				"cline-ui-agent-team-panel border-b border-cline-ui-border text-cline-ui-xs",
				className,
			)}
		>
			<button
				aria-expanded={open}
				className="cline-ui-agent-team-panel__header flex w-full min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent px-4 py-2 text-left text-inherit transition-colors hover:bg-cline-ui-surface-hover"
				onClick={() => setOpen((value) => !value)}
				type="button"
			>
				<Users
					aria-hidden="true"
					className="size-3.5 shrink-0 text-cline-ui-muted-foreground"
				/>
				<span className="shrink-0 font-cline-ui-medium text-cline-ui-foreground">
					Team
				</span>
				{teamName ? (
					<span className="min-w-0 truncate font-cline-ui-mono text-[11px] text-cline-ui-muted-foreground">
						{teamName}
					</span>
				) : null}
				<span className="ml-auto shrink-0 text-cline-ui-muted-foreground">
					{summarizeAgentTeam(members)}
				</span>
				<span className="shrink-0 font-cline-ui-mono text-[11px] tabular-nums text-cline-ui-muted-foreground">
					{formatAgentTeamElapsed(endedAt - startedAt)}
				</span>
				<ChevronDown
					aria-hidden="true"
					className={clsx(
						"size-3.5 shrink-0 text-cline-ui-muted-foreground transition-transform",
						!open && "-rotate-90",
					)}
				/>
			</button>
			{open ? (
				<ul className="m-0 max-h-52 list-none overflow-y-auto overscroll-contain p-0 pb-1.5">
					{members.map((member) => (
						<AgentTeamPanelRow
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

export const AgentTeamPanel = memo(AgentTeamPanelImpl);

function AgentTeamPanelRow({
	member,
	now,
	active,
	onOpen,
}: {
	member: AgentTeamMember;
	now: number;
	active: boolean;
	onOpen: () => void;
}) {
	const { phase } = member;
	const bucket = agentTeamPhaseBucket(phase);
	const PhaseIcon = PHASE_ICON[phase];
	const working = bucket === "planning" || bucket === "acting";
	const detail = phase === "done" ? member.task : (member.step ?? member.task);

	return (
		<li>
			<button
				aria-current={active || undefined}
				className={clsx(
					"cline-ui-agent-team-panel__row grid w-full cursor-pointer grid-cols-[0.875rem_minmax(0,8rem)_6.5rem_minmax(0,1fr)_3.5rem_0.875rem] items-center gap-2 border-0 px-4 py-1 text-left text-inherit transition-colors hover:bg-cline-ui-surface-hover",
					active ? "bg-cline-ui-surface-hover" : "bg-transparent",
				)}
				data-phase={phase}
				onClick={onOpen}
				title={
					member.task ? `${member.agentId}: ${member.task}` : member.agentId
				}
				type="button"
			>
				{working ? (
					<Loader2
						aria-hidden="true"
						className={clsx(
							"size-3.5 animate-spin",
							bucket === "acting"
								? "text-cline-ui-foreground"
								: "text-cline-ui-muted-foreground",
						)}
					/>
				) : bucket === "done" ? (
					<Check
						aria-hidden="true"
						className="size-3.5 text-cline-ui-success-text"
					/>
				) : bucket === "failed" ? (
					<AlertCircle
						aria-hidden="true"
						className="size-3.5 text-cline-ui-error-text"
					/>
				) : (
					<Clock3
						aria-hidden="true"
						className="size-3.5 text-cline-ui-muted-foreground"
					/>
				)}
				<span className="truncate font-cline-ui-medium text-cline-ui-foreground">
					{member.agentId}
				</span>
				<span
					className={clsx(
						"flex min-w-0 items-center gap-1",
						bucket === "done"
							? "text-cline-ui-success-text"
							: bucket === "failed"
								? "text-cline-ui-error-text"
								: bucket === "acting"
									? "text-cline-ui-foreground"
									: "text-cline-ui-muted-foreground",
					)}
				>
					<PhaseIcon aria-hidden="true" className="size-3 shrink-0" />
					<span className="truncate">{PHASE_LABEL[phase]}</span>
				</span>
				<span
					className={clsx(
						"truncate text-cline-ui-muted-foreground",
						phase === "waiting" && "italic",
					)}
				>
					{detail}
				</span>
				<span className="text-right font-cline-ui-mono text-[11px] tabular-nums text-cline-ui-muted-foreground">
					{formatAgentTeamElapsed((member.endedAt ?? now) - member.startedAt)}
				</span>
				<ChevronRight
					aria-hidden="true"
					className="size-3.5 text-cline-ui-muted-foreground"
				/>
			</button>
		</li>
	);
}

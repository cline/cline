"use client";

import {
	Check,
	ChevronDown,
	ChevronRight,
	Clock3,
	Eye,
	FlaskConical,
	Lightbulb,
	Loader2,
	Pencil,
	Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { TeammatePhase } from "./team-script";

export type TeamPanelMember = {
	id: string;
	title: string;
	phase: TeammatePhase;
	step?: string;
	startedAt: number;
	endedAt?: number;
};

const PHASE_LABEL: Record<TeammatePhase, string> = {
	planning: "Planning",
	editing: "Editing",
	testing: "Testing",
	reviewing: "Reviewing",
	waiting: "Waiting",
	done: "Done",
};

const PHASE_ICON: Record<TeammatePhase, typeof Check> = {
	planning: Lightbulb,
	editing: Pencil,
	testing: FlaskConical,
	reviewing: Eye,
	waiting: Clock3,
	done: Check,
};

const isActing = (phase: TeammatePhase) =>
	phase === "editing" || phase === "testing";

function formatElapsed(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	const minutes = Math.floor(seconds / 60);
	return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function summarize(members: TeamPanelMember[]): string {
	const count = (match: (phase: TeammatePhase) => boolean) =>
		members.filter((member) => match(member.phase)).length;
	return [
		[count((phase) => phase === "planning"), "planning"],
		[count(isActing), "acting"],
		[count((phase) => phase === "reviewing"), "reviewing"],
		[count((phase) => phase === "waiting"), "waiting"],
		[count((phase) => phase === "done"), "done"],
	]
		.filter(([value]) => Number(value) > 0)
		.map(([value, label]) => `${value} ${label}`)
		.join(" · ");
}

/**
 * Live view of a running team, attached to the top of the chat input in the
 * slot the pull request bar uses. One row per teammate says what it is doing
 * right now, so planning, building, and reviewing are visible at a glance, and
 * selecting a row opens that teammate's session. Once every teammate is done it
 * folds to a one-line summary.
 */
export function TeamPanel({
	name,
	members,
	now,
	activeId,
	onOpen,
}: {
	name: string;
	members: TeamPanelMember[];
	now: number;
	activeId?: string;
	onOpen: (id: string) => void;
}) {
	const finished =
		members.length > 0 && members.every((member) => member.phase === "done");
	const [open, setOpen] = useState(true);
	useEffect(() => {
		if (finished) setOpen(false);
	}, [finished]);
	if (members.length === 0) return null;
	const startedAt = Math.min(...members.map((member) => member.startedAt));
	const endedAt = finished
		? Math.max(...members.map((member) => member.endedAt ?? now))
		: now;

	return (
		<section
			aria-label="Team"
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
				<span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
					{name}
				</span>
				<span className="ml-auto shrink-0 text-muted-foreground">
					{summarize(members)}
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
				<ul className="pb-1.5">
					{members.map((member) => (
						<TeamPanelRow
							active={member.id === activeId}
							key={member.id}
							member={member}
							now={now}
							onOpen={() => onOpen(member.id)}
						/>
					))}
				</ul>
			) : null}
		</section>
	);
}

function TeamPanelRow({
	member,
	now,
	active,
	onOpen,
}: {
	member: TeamPanelMember;
	now: number;
	active: boolean;
	onOpen: () => void;
}) {
	const { phase } = member;
	const PhaseIcon = PHASE_ICON[phase];
	const working = phase !== "waiting" && phase !== "done";

	return (
		<li>
			<button
				aria-current={active || undefined}
				className={cn(
					"grid w-full grid-cols-[0.875rem_7.5rem_5.75rem_minmax(0,1fr)_3.5rem_0.875rem] items-center gap-2 px-4 py-1 text-left transition-colors hover:bg-surface-hover",
					active && "bg-surface-hover",
				)}
				onClick={onOpen}
				title={member.title}
				type="button"
			>
				{working ? (
					<Loader2
						aria-hidden="true"
						className={cn(
							"size-3.5 animate-spin",
							isActing(phase) ? "text-foreground" : "text-muted-foreground",
						)}
					/>
				) : phase === "done" ? (
					<Check aria-hidden="true" className="size-3.5 text-chart-2" />
				) : (
					<Clock3
						aria-hidden="true"
						className="size-3.5 text-muted-foreground"
					/>
				)}
				<span className="truncate font-medium text-foreground">
					{member.id}
				</span>
				<span
					className={cn(
						"flex min-w-0 items-center gap-1",
						phase === "done"
							? "text-chart-2"
							: isActing(phase) || phase === "reviewing"
								? "text-foreground"
								: "text-muted-foreground",
					)}
				>
					<PhaseIcon aria-hidden="true" className="size-3 shrink-0" />
					{PHASE_LABEL[phase]}
				</span>
				<span
					className={cn(
						"truncate text-muted-foreground",
						phase === "waiting" && "italic",
					)}
				>
					{phase === "done" ? member.title : member.step}
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

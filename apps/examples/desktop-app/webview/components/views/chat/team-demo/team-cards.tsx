"use client";

import {
	Bot,
	Check,
	CircleCheck,
	Circle,
	Database,
	Eye,
	Hammer,
	Hourglass,
	LayoutPanelTop,
	Lightbulb,
	Loader2,
	type LucideIcon,
	Network,
	OctagonAlert,
	PanelRightOpen,
	Plug,
	ScanEye,
	Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { STREAMING_TITLE_CLASS } from "../messages/constants";
import type {
	MemberStatus,
	TeamMember,
	TeamState,
	TeamTask,
	TeamTaskStatus,
} from "./team-script";

const AVATARS: Record<string, { icon: LucideIcon; tint: string }> = {
	lead: { icon: Bot, tint: "bg-violet-500" },
	"backend-dev": { icon: Database, tint: "bg-sky-500" },
	"ui-dev": { icon: LayoutPanelTop, tint: "bg-pink-500" },
	"integration-dev": { icon: Plug, tint: "bg-amber-500" },
	"qa-engineer": { icon: ScanEye, tint: "bg-emerald-500" },
};

export function MemberAvatar({
	id,
	size = "md",
}: {
	id: string;
	size?: "sm" | "md" | "lg";
}) {
	const { icon: Icon, tint } = AVATARS[id] ?? {
		icon: Bot,
		tint: "bg-slate-500",
	};
	return (
		<span
			className={cn(
				"inline-grid shrink-0 place-items-center rounded-full text-white shadow-sm",
				tint,
				size === "sm" && "size-5 [&_svg]:size-3",
				size === "md" && "size-7 [&_svg]:size-3.5",
				size === "lg" && "size-9 [&_svg]:size-4.5",
			)}
		>
			<Icon />
		</span>
	);
}

const STATUS: Record<
	MemberStatus,
	{ label: string; icon: LucideIcon; className: string; active: boolean }
> = {
	planning: {
		label: "Planning",
		icon: Lightbulb,
		className: "bg-violet-500/12 text-violet-600 dark:text-violet-300",
		active: true,
	},
	working: {
		label: "Working",
		icon: Hammer,
		className: "bg-sky-500/12 text-sky-600 dark:text-sky-300",
		active: true,
	},
	blocked: {
		label: "Blocked",
		icon: OctagonAlert,
		className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
		active: false,
	},
	reviewing: {
		label: "Reviewing",
		icon: Eye,
		className: "bg-teal-500/12 text-teal-700 dark:text-teal-300",
		active: true,
	},
	waiting: {
		label: "Waiting",
		icon: Hourglass,
		className: "bg-muted text-muted-foreground",
		active: false,
	},
	done: {
		label: "Done",
		icon: Check,
		className: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
		active: false,
	},
};

export function isActiveStatus(status: MemberStatus) {
	return STATUS[status].active;
}

export function StatusPill({ status }: { status: MemberStatus }) {
	const { label, icon: Icon, className, active } = STATUS[status];
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
				className,
			)}
		>
			{active ? (
				<span className="size-1.5 animate-pulse rounded-full bg-current" />
			) : (
				<Icon className="size-3" />
			)}
			{label}
		</span>
	);
}

export function ActivityText({
	member,
	className,
}: {
	member: TeamMember;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"block truncate",
				isActiveStatus(member.status) && STREAMING_TITLE_CLASS,
				className,
			)}
		>
			{member.activity}
		</span>
	);
}

export function TaskStatusIcon({
	status,
	className,
}: {
	status: TeamTaskStatus;
	className?: string;
}) {
	if (status === "completed")
		return (
			<CircleCheck
				className={cn("size-4 shrink-0 text-emerald-500", className)}
			/>
		);
	if (status === "in_progress")
		return (
			<Loader2
				className={cn("size-4 shrink-0 animate-spin text-sky-500", className)}
			/>
		);
	if (status === "blocked")
		return (
			<OctagonAlert
				className={cn("size-4 shrink-0 text-amber-500", className)}
			/>
		);
	return (
		<Circle
			className={cn("size-4 shrink-0 text-muted-foreground/60", className)}
		/>
	);
}

export function taskProgress(tasks: TeamTask[]) {
	const done = tasks.filter((t) => t.status === "completed").length;
	return {
		done,
		total: tasks.length,
		pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
	};
}

function MissionControlButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted"
			onClick={onClick}
			type="button"
		>
			<PanelRightOpen className="size-3.5" />
			Mission control
		</button>
	);
}

/** Inline transcript card: the lead's plan as roster plus dependent tasks. */
export function TeamPlanCard({
	team,
	onOpenMissionControl,
}: {
	team: TeamState;
	onOpenMissionControl: () => void;
}) {
	const teammates = team.members.filter((m) => !m.lead);
	const { done, total, pct } = taskProgress(team.tasks);
	return (
		<div className="animate-in fade-in-0 slide-in-from-bottom-1 rounded-xl border border-border bg-card p-4 duration-300">
			<div className="flex items-center gap-3">
				<span className="grid size-8 place-items-center rounded-lg bg-primary/12 text-primary">
					<Network className="size-4" />
				</span>
				<div className="min-w-0 flex-1">
					<div className="text-sm font-semibold">Team plan</div>
					<div className="text-xs text-muted-foreground">
						{teammates.length} teammates · {total} tasks · {team.name}
					</div>
				</div>
				<span className="text-xs tabular-nums text-muted-foreground">
					{done}/{total} done
				</span>
				<MissionControlButton onClick={onOpenMissionControl} />
			</div>
			<div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
				<div
					className="h-full rounded-full bg-primary transition-[width] duration-700"
					style={{ width: `${pct}%` }}
				/>
			</div>
			<div className="mt-3 flex flex-wrap gap-2">
				{teammates.map((m) => (
					<span
						className="inline-flex items-center gap-1.5 rounded-full border border-border py-0.5 pl-0.5 pr-2.5 text-xs"
						key={m.id}
					>
						<MemberAvatar id={m.id} size="sm" />
						<span className="font-medium">{m.name}</span>
						<span className="text-muted-foreground">{m.role}</span>
					</span>
				))}
			</div>
			<ul className="mt-3 divide-y divide-border/60 rounded-lg border border-border/70">
				{team.tasks.map((t) => (
					<li
						className="flex animate-in fade-in-0 items-center gap-2.5 px-3 py-2 text-sm duration-300"
						key={t.id}
					>
						<TaskStatusIcon status={t.status} />
						<span className="w-6 shrink-0 font-mono text-[11px] text-muted-foreground">
							{t.id}
						</span>
						<span
							className={cn(
								"min-w-0 flex-1 truncate",
								t.status === "completed" && "text-muted-foreground",
							)}
						>
							{t.title}
						</span>
						{t.dependsOn.length ? (
							<span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
								after {t.dependsOn.join(", ")}
							</span>
						) : null}
						<span className="inline-flex w-32 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
							<MemberAvatar id={t.assignee} size="sm" />
							<span className="truncate">{t.assignee}</span>
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

/** Inline transcript card: one live lane per teammate. Clicking a lane opens Mission control on it. */
export function TeamLanesCard({
	team,
	onFocusMember,
}: {
	team: TeamState;
	onFocusMember: (id: string) => void;
}) {
	const teammates = team.members.filter((m) => !m.lead);
	const running = teammates.filter((m) => isActiveStatus(m.status)).length;
	return (
		<div className="animate-in fade-in-0 slide-in-from-bottom-1 rounded-xl border border-border bg-card p-4 duration-300">
			<div className="mb-3 flex items-center gap-2 text-sm">
				<Users className="size-4 text-muted-foreground" />
				<span className="font-semibold">Teammates</span>
				<span className="text-xs text-muted-foreground">
					{running > 0 ? `${running} working in parallel` : "all idle"}
				</span>
			</div>
			<div className="grid gap-2 sm:grid-cols-2">
				{teammates.map((m) => {
					const tasks = team.tasks.filter((t) => t.assignee === m.id);
					return (
						<button
							className={cn(
								"group flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/50",
								m.status === "blocked" && "border-amber-500/40",
							)}
							key={m.id}
							onClick={() => onFocusMember(m.id)}
							type="button"
						>
							<div className="flex items-center gap-2">
								<MemberAvatar id={m.id} />
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm font-medium">{m.name}</div>
									<div className="truncate text-[11px] text-muted-foreground">
										{m.role}
									</div>
								</div>
								<StatusPill status={m.status} />
							</div>
							<ActivityText className="text-xs font-medium" member={m} />
							<ul className="flex min-h-[3.25rem] flex-col gap-0.5">
								{m.recent.map((step, index) => (
									<li
										className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground"
										key={`${index}-${step}`}
										style={{ opacity: 1 - index * 0.25 }}
									>
										<Check className="size-3 shrink-0" />
										<span className="truncate">{step}</span>
									</li>
								))}
							</ul>
							<div className="flex flex-wrap gap-1">
								{tasks.map((t) => (
									<span
										className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
										key={t.id}
										title={t.title}
									>
										<TaskStatusIcon className="size-3" status={t.status} />
										{t.id}
									</span>
								))}
							</div>
						</button>
					);
				})}
			</div>
		</div>
	);
}

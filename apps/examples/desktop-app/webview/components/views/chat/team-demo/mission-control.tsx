"use client";

import {
	ArrowRightLeft,
	CircleCheck,
	FileText,
	Lightbulb,
	MessageSquare,
	OctagonAlert,
	Radio,
	TrendingUp,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
	ActivityText,
	isActiveStatus,
	MemberAvatar,
	StatusPill,
	TaskStatusIcon,
	taskProgress,
} from "./team-cards";
import type { FeedKind, TeamState, TeamTaskStatus } from "./team-script";

const COLUMNS: { status: TeamTaskStatus; label: string }[] = [
	{ status: "pending", label: "Pending" },
	{ status: "in_progress", label: "In progress" },
	{ status: "blocked", label: "Blocked" },
	{ status: "completed", label: "Done" },
];

const FEED: Record<
	FeedKind,
	{ label: string; icon: typeof Lightbulb; className: string }
> = {
	decision: {
		label: "Decision",
		icon: Lightbulb,
		className: "text-violet-600 dark:text-violet-300",
	},
	handoff: {
		label: "Handoff",
		icon: ArrowRightLeft,
		className: "text-sky-600 dark:text-sky-300",
	},
	blocked: {
		label: "Blocked",
		icon: OctagonAlert,
		className: "text-amber-700 dark:text-amber-300",
	},
	done: {
		label: "Done",
		icon: CircleCheck,
		className: "text-emerald-700 dark:text-emerald-300",
	},
	progress: {
		label: "Progress",
		icon: TrendingUp,
		className: "text-muted-foreground",
	},
	message: {
		label: "Message",
		icon: MessageSquare,
		className: "text-sky-600 dark:text-sky-300",
	},
};

function useElapsed(startedAt: number, running: boolean) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!running) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [running]);
	const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Section({
	title,
	right,
	children,
	className,
}: {
	title: string;
	right?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<section className={cn("flex shrink-0 flex-col", className)}>
			<div className="mb-2 flex items-center gap-2">
				<h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
					{title}
				</h3>
				{right}
			</div>
			{children}
		</section>
	);
}

export function MissionControl({
	team,
	running,
	focusedMember,
	onFocusMember,
	onClose,
}: {
	team: TeamState;
	running: boolean;
	focusedMember: string | null;
	onFocusMember: (id: string | null) => void;
	onClose: () => void;
}) {
	const elapsed = useElapsed(team.startedAt, running);
	const { done, total, pct } = taskProgress(team.tasks);
	const active = team.members.filter((m) => isActiveStatus(m.status)).length;
	const messages = team.feed.filter(
		(f) => f.kind === "message" || f.kind === "handoff",
	).length;
	const feed = focusedMember
		? team.feed.filter(
				(f) => f.agentId === focusedMember || f.to === focusedMember,
			)
		: team.feed;
	const feedEnd = useRef<HTMLDivElement>(null);
	const lastFeedId = feed.at(-1)?.id;

	useEffect(() => {
		void lastFeedId;
		feedEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}, [lastFeedId]);

	return (
		<aside
			aria-label="Mission control"
			className="flex h-full min-h-0 flex-col border-l border-border bg-background"
		>
			<header className="flex items-center gap-3 border-b border-border px-5 py-3">
				<span className="grid size-8 place-items-center rounded-lg bg-primary/12 text-primary">
					<Radio className="size-4" />
				</span>
				<div className="min-w-0">
					<div className="text-sm font-semibold">Mission control</div>
					<div className="truncate text-xs text-muted-foreground">
						{team.name} · {active} active · {messages} messages · {elapsed}
					</div>
				</div>
				<div className="ml-auto flex w-40 items-center gap-2">
					<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
						<div
							className="h-full rounded-full bg-primary transition-[width] duration-700"
							style={{ width: `${pct}%` }}
						/>
					</div>
					<span className="text-xs tabular-nums text-muted-foreground">
						{done}/{total}
					</span>
				</div>
				<button
					aria-label="Close mission control"
					className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
					onClick={onClose}
					type="button"
				>
					<X className="size-4" />
				</button>
			</header>

			<div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
				<Section
					title="Agents"
					right={
						focusedMember ? (
							<button
								className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
								onClick={() => onFocusMember(null)}
								type="button"
							>
								Showing {focusedMember} · clear
							</button>
						) : null
					}
				>
					<div className="grid grid-cols-5 gap-2">
						{team.members.map((m) => (
							<button
								className={cn(
									"flex min-w-0 animate-in fade-in-0 flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left transition-all duration-300 hover:border-primary/40",
									focusedMember === m.id &&
										"border-primary ring-2 ring-primary/25",
									focusedMember && focusedMember !== m.id && "opacity-55",
									m.status === "blocked" &&
										focusedMember !== m.id &&
										"border-amber-500/40",
								)}
								key={m.id}
								onClick={() =>
									onFocusMember(focusedMember === m.id ? null : m.id)
								}
								type="button"
							>
								<div className="flex items-center gap-2">
									<MemberAvatar id={m.id} />
									<div className="min-w-0">
										<div className="truncate text-sm font-medium">{m.name}</div>
										<div className="truncate text-[11px] text-muted-foreground">
											{m.lead ? "Lead" : m.role}
										</div>
									</div>
								</div>
								<StatusPill status={m.status} />
								<ActivityText className="text-xs" member={m} />
							</button>
						))}
					</div>
				</Section>

				<Section title="Tasks">
					<div className="grid grid-cols-4 gap-2">
						{COLUMNS.map((column) => {
							const tasks = team.tasks.filter(
								(t) => t.status === column.status,
							);
							return (
								<div
									className={cn(
										"flex min-h-36 flex-col gap-2 rounded-lg bg-muted/50 p-2",
										column.status === "blocked" &&
											tasks.length > 0 &&
											"bg-amber-500/10",
									)}
									key={column.status}
								>
									<div className="flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
										<TaskStatusIcon
											className="size-3.5"
											status={column.status}
										/>
										{column.label}
										<span className="ml-auto tabular-nums">{tasks.length}</span>
									</div>
									{tasks.map((t) =>
										t.status === "completed" ? (
											<div
												className={cn(
													"flex animate-in fade-in-0 zoom-in-95 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 duration-300",
													focusedMember &&
														focusedMember !== t.assignee &&
														"opacity-45",
												)}
												key={t.id}
												title={t.title}
											>
												<MemberAvatar id={t.assignee} size="sm" />
												<span className="font-mono text-[10px] text-muted-foreground">
													{t.id}
												</span>
												<span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
													{t.title}
												</span>
											</div>
										) : (
											<div
												className={cn(
													"animate-in fade-in-0 zoom-in-95 rounded-md border border-border bg-card p-2 shadow-xs duration-300",
													focusedMember &&
														focusedMember !== t.assignee &&
														"opacity-45",
												)}
												key={t.id}
											>
												<div className="flex items-start gap-1.5">
													<span className="mt-px font-mono text-[10px] text-muted-foreground">
														{t.id}
													</span>
													<span className="min-w-0 flex-1 text-xs font-medium leading-snug">
														{t.title}
													</span>
												</div>
												{t.note ? (
													<div className="mt-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
														{t.note}
													</div>
												) : null}
												<div className="mt-2 flex items-center gap-1.5">
													<MemberAvatar id={t.assignee} size="sm" />
													<span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
														{t.assignee}
													</span>
													{t.dependsOn.length && t.status === "pending" ? (
														<span className="shrink-0 text-[10px] text-muted-foreground">
															after {t.dependsOn.join(", ")}
														</span>
													) : null}
												</div>
											</div>
										),
									)}
								</div>
							);
						})}
					</div>
				</Section>

				<div className="grid shrink-0 grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-4">
					<Section title="Activity">
						<div className="flex max-h-80 min-h-56 flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-card p-3">
							{feed.length === 0 ? (
								<div className="m-auto text-xs text-muted-foreground">
									Decisions, handoffs, and messages show up here.
								</div>
							) : null}
							{feed.map((entry) => {
								const kind = FEED[entry.kind];
								const Icon = kind.icon;
								return (
									<div
										className="flex animate-in fade-in-0 slide-in-from-bottom-1 gap-2.5 duration-300"
										key={entry.id}
									>
										<MemberAvatar id={entry.agentId} size="sm" />
										<div className="min-w-0 flex-1">
											<div className="flex flex-wrap items-center gap-x-1.5 text-[11px]">
												<span className="font-semibold">
													{team.members.find((m) => m.id === entry.agentId)
														?.name ?? entry.agentId}
												</span>
												{entry.to ? (
													<span className="text-muted-foreground">
														to {entry.to}
													</span>
												) : null}
												<span
													className={cn(
														"inline-flex items-center gap-1 font-medium",
														kind.className,
													)}
												>
													<Icon className="size-3" />
													{kind.label}
												</span>
											</div>
											<p className="mt-0.5 text-xs leading-relaxed text-foreground/90">
												{entry.text}
											</p>
											{entry.image ? (
												// biome-ignore lint/performance/noImgElement: Bundled demo screenshot.
												<img
													alt=""
													className="mt-1.5 h-28 w-auto rounded-md border border-border"
													src={entry.image}
												/>
											) : null}
										</div>
									</div>
								);
							})}
							<div ref={feedEnd} />
						</div>
					</Section>

					<Section
						title="Outcome"
						right={
							team.outcome ? (
								<span
									className={cn(
										"ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold",
										team.outcome.finalized
											? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
											: "bg-muted text-muted-foreground",
									)}
								>
									{team.outcome.finalized ? "Finalized" : "Draft"}
								</span>
							) : null
						}
					>
						<div className="flex min-h-56 flex-col gap-2 rounded-lg border border-border bg-card p-3">
							{team.outcome ? (
								<>
									<div className="flex items-center gap-2 text-sm font-semibold">
										<FileText className="size-4 text-muted-foreground" />
										{team.outcome.title}
									</div>
									{team.outcome.sections.map((s) => (
										<div
											className={cn(
												"rounded-md border border-dashed border-border p-2 transition-colors duration-500",
												s.status !== "missing" && "border-solid bg-background",
											)}
											key={s.id}
										>
											<div className="flex items-center gap-1.5 text-xs font-medium">
												<MemberAvatar id={s.author} size="sm" />
												<span className="min-w-0 flex-1 truncate">
													{s.title}
												</span>
												<span
													className={cn(
														"text-[10px] font-semibold uppercase tracking-wide",
														s.status === "reviewed"
															? "text-emerald-600 dark:text-emerald-300"
															: s.status === "draft"
																? "text-sky-600 dark:text-sky-300"
																: "text-muted-foreground/70",
													)}
												>
													{s.status === "missing" ? "waiting" : s.status}
												</span>
											</div>
											{s.text ? (
												<p className="mt-1 animate-in fade-in-0 text-[11px] leading-snug text-muted-foreground duration-500">
													{s.text}
												</p>
											) : null}
										</div>
									))}
								</>
							) : (
								<div className="m-auto text-xs text-muted-foreground">
									The lead creates an outcome once the plan is set.
								</div>
							)}
						</div>
					</Section>
				</div>
			</div>
		</aside>
	);
}

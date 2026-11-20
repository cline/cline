import {
	ArrowUpRight,
	Boxes,
	CircleDollarSign,
	Clock3,
	Cpu,
	FileCode2,
	Plus,
	Sparkles,
	TerminalSquare,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, EmptyState, Panel, SectionHeading, Stat, StatusBadge } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { limitsForPlan } from "@/lib/plans";
import { getOrCreateProfile } from "@/lib/profile";
import { getServiceClient } from "@/lib/supabase/service";
import type { ProjectRow, TaskEventRow, TaskRow } from "@/lib/types";
import { getMonthlyUsage, startOfMonth } from "@/lib/usage";
import {
	formatCompact,
	formatNumber,
	formatRelativeTime,
	formatUsd,
	humanizeStatus,
} from "@/lib/utils";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
	const user = await getCurrentUser();
	if (!user) return null;
	const profile = await getOrCreateProfile(user);
	const client = getServiceClient();

	const [projectsResult, tasksResult, activeResult, monthTasksResult, eventsResult, usage] =
		await Promise.all([
			client
				.from("a21_projects")
				.select("*")
				.eq("owner_id", user.id)
				.eq("status", "active")
				.order("updated_at", { ascending: false })
				.limit(4),
			client
				.from("a21_tasks")
				.select("*")
				.eq("owner_id", user.id)
				.order("created_at", { ascending: false })
				.limit(6),
			client
				.from("a21_tasks")
				.select("id", { count: "exact", head: true })
				.eq("owner_id", user.id)
				.in("status", ["queued", "provisioning", "running", "waiting_approval"]),
			client
				.from("a21_tasks")
				.select("id", { count: "exact", head: true })
				.eq("owner_id", user.id)
				.gte("created_at", startOfMonth().toISOString()),
			client
				.from("a21_task_events")
				.select("*")
				.eq("owner_id", user.id)
				.order("id", { ascending: false })
				.limit(8),
			getMonthlyUsage(user.id),
		]);

	const projects = (projectsResult.data ?? []) as ProjectRow[];
	const tasks = (tasksResult.data ?? []) as TaskRow[];
	const events = (eventsResult.data ?? []) as TaskEventRow[];
	const limits = limitsForPlan(profile.plan);

	const taskTitles = new Map(tasks.map((task) => [task.id, task.title]));
	if (events.some((event) => !taskTitles.has(event.task_id))) {
		const ids = [...new Set(events.map((event) => event.task_id))].filter(
			(id) => !taskTitles.has(id),
		);
		if (ids.length > 0) {
			const { data } = await client.from("a21_tasks").select("id, title").in("id", ids);
			for (const row of data ?? []) taskTitles.set(row.id as string, row.title as string);
		}
	}

	const tokenPercent = Math.min(
		100,
		Math.round((usage.totals.totalTokens / Math.max(1, limits.tokensPerMonth)) * 100),
	);
	const taskPercent = Math.min(
		100,
		Math.round(((monthTasksResult.count ?? 0) / Math.max(1, limits.tasksPerMonth)) * 100),
	);

	const firstName = (profile.display_name || user.email || "there").split(/[@\s]/)[0];

	return (
		<div className="space-y-7">
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="eyebrow">Overview</p>
					<h1 className="display mt-2 text-3xl font-semibold sm:text-[2.4rem]">
						Good to see you, {firstName}.
					</h1>
					<p className="mt-2 text-sm text-mist-500">
						{activeResult.count
							? `${activeResult.count} task${activeResult.count === 1 ? "" : "s"} in flight · `
							: ""}
						{projects.length
							? "your sandboxes are one click away."
							: "create a project to give the agent somewhere to work."}
					</p>
				</div>
				<div className="flex gap-2">
					<Link href="/app/projects?new=1" className="btn btn-primary">
						<Plus className="size-4" /> New project
					</Link>
					<Link href="/app/tasks" className="btn btn-secondary">
						All tasks <ArrowUpRight className="size-3.5" />
					</Link>
				</div>
			</header>

			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				<Stat
					label="Projects"
					value={formatNumber(projectsResult.data?.length ?? 0)}
					detail={`${limits.projects} allowed on ${profile.plan}`}
					icon={Boxes}
					accent="signal"
				/>
				<Stat
					label="Active tasks"
					value={formatNumber(activeResult.count ?? 0)}
					detail={`${limits.concurrentTasks} concurrent on ${profile.plan}`}
					icon={TerminalSquare}
					accent="mint"
				/>
				<Stat
					label="Tokens this month"
					value={formatCompact(usage.totals.totalTokens)}
					detail={
						<div className="space-y-1.5">
							<div className="h-1 overflow-hidden rounded-full bg-white/10">
								<div
									className="h-full rounded-full bg-signal-400"
									style={{ width: `${tokenPercent}%` }}
								/>
							</div>
							<span>
								{tokenPercent}% of {formatCompact(limits.tokensPerMonth)} tokens
							</span>
						</div>
					}
					icon={Cpu}
					accent="iris"
				/>
				<Stat
					label="Model spend"
					value={formatUsd(usage.totals.costUsd)}
					detail={`${formatNumber(monthTasksResult.count ?? 0)} of ${formatNumber(
						limits.tasksPerMonth,
					)} tasks · ${taskPercent}%`}
					icon={CircleDollarSign}
				/>
			</div>

			<div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
				<Panel className="overflow-hidden">
					<div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
						<SectionHeading
							title="Recent tasks"
							description="Every run keeps its events, diffs and terminal output."
						/>
						<Link href="/app/tasks" className="text-[0.6875rem] text-mist-500 hover:text-mist-200">
							View all
						</Link>
					</div>
					{tasks.length === 0 ? (
						<div className="p-5">
							<EmptyState
								icon={Sparkles}
								title="No tasks yet"
								description="Open a project and describe a change. The agent will inspect the real files before proposing edits."
								action={
									<Link href="/app/projects" className="btn btn-secondary">
										Go to projects
									</Link>
								}
							/>
						</div>
					) : (
						<div className="divide-y divide-white/[0.055]">
							{tasks.map((task) => (
								<Link
									key={task.id}
									href={`/app/tasks/${task.id}`}
									className="group flex items-center gap-4 px-5 py-3.5 transition hover:bg-white/[0.022]"
								>
									<span className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-mist-500 group-hover:text-signal-300">
										<FileCode2 className="size-3.5" strokeWidth={1.7} />
									</span>
									<div className="min-w-0 flex-1">
										<p className="truncate text-[0.8125rem] font-medium text-mist-100">
											{task.title}
										</p>
										<p className="mt-0.5 truncate font-mono text-[0.65rem] text-mist-600">
											{task.model_id} · {formatRelativeTime(task.created_at)}
										</p>
									</div>
									<div className="flex items-center gap-3">
										{task.files_changed > 0 ? (
											<span className="hidden text-[0.65rem] text-mist-600 sm:block">
												{task.files_changed} file{task.files_changed === 1 ? "" : "s"}
											</span>
										) : null}
										<StatusBadge status={task.status} />
									</div>
								</Link>
							))}
						</div>
					)}
				</Panel>

				<Panel className="overflow-hidden">
					<div className="border-b border-white/[0.06] px-5 py-4">
						<SectionHeading
							title="Live activity"
							description="Latest agent events across your workspace."
						/>
					</div>
					{events.length === 0 ? (
						<div className="p-5">
							<EmptyState
								icon={Clock3}
								title="Quiet for now"
								description="Agent tool calls, edits and command output will appear here as tasks run."
							/>
						</div>
					) : (
						<ol className="space-y-0 divide-y divide-white/[0.055]">
							{events.map((event) => (
								<li key={event.id} className="flex gap-3 px-5 py-3">
									<span
										className={
											event.level === "error"
												? "mt-1.5 size-1.5 shrink-0 rounded-full bg-rose-400"
												: event.level === "warn"
													? "mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-400"
													: "mt-1.5 size-1.5 shrink-0 rounded-full bg-signal-400/80"
										}
									/>
									<div className="min-w-0 flex-1">
										<p className="truncate text-[0.75rem] text-mist-300">
											{event.message || humanizeStatus(event.type)}
										</p>
										<p className="mt-0.5 truncate font-mono text-[0.65rem] text-mist-600">
											{taskTitles.get(event.task_id) ?? "task"} ·{" "}
											{formatRelativeTime(event.created_at)}
										</p>
									</div>
								</li>
							))}
						</ol>
					)}
				</Panel>
			</div>

			<Panel className="overflow-hidden">
				<div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
					<SectionHeading
						title="Projects"
						description="Each project gets its own isolated sandbox."
					/>
					<Link href="/app/projects" className="text-[0.6875rem] text-mist-500 hover:text-mist-200">
						Manage projects
					</Link>
				</div>
				{projects.length === 0 ? (
					<div className="p-5">
						<EmptyState
							icon={Boxes}
							title="No project yet"
							description="Pick a language template and 21 Agent will provision a persistent Daytona workspace for it."
							action={
								<Link href="/app/projects?new=1" className="btn btn-primary">
									<Plus className="size-4" /> Create a project
								</Link>
							}
						/>
					</div>
				) : (
					<div className="grid gap-px bg-white/[0.055] sm:grid-cols-2 xl:grid-cols-4">
						{projects.map((project) => (
							<Link
								key={project.id}
								href={`/app/projects/${project.id}`}
								className="group bg-ink-850/80 p-5 transition hover:bg-ink-800"
							>
								<div className="flex items-start justify-between">
									<span className="grid size-8 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.03] font-mono text-[0.6rem] uppercase text-mist-400">
										{project.language.slice(0, 2)}
									</span>
									<ArrowUpRight className="size-3.5 text-mist-600 transition group-hover:text-signal-300" />
								</div>
								<p className="mt-3 truncate text-[0.8125rem] font-medium">{project.name}</p>
								<p className="mt-1 line-clamp-2 text-[0.7rem] leading-relaxed text-mist-600">
									{project.description || "No description"}
								</p>
								<div className="mt-3 flex items-center gap-1.5">
									<Badge>{project.language}</Badge>
									<Badge tone={project.approval_mode === "auto" ? "muted" : "info"}>
										{project.approval_mode === "writes" ? "approvals" : project.approval_mode}
									</Badge>
								</div>
							</Link>
						))}
					</div>
				)}
			</Panel>
		</div>
	);
}

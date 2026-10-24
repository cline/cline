"use client";

import { ArrowUpRight, FileCode2, Search, TerminalSquare } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState, StatusBadge } from "@/components/ui";
import type { ProjectRow, TaskRow } from "@/lib/types";
import { cn, formatCompact, formatRelativeTime, formatUsd } from "@/lib/utils";

const STATUS_FILTERS = [
	"all",
	"queued",
	"provisioning",
	"running",
	"waiting_approval",
	"succeeded",
	"failed",
	"cancelled",
] as const;

export function TasksView({
	initialTasks,
	projects,
	initialProjectId,
	initialStatus,
}: {
	initialTasks: TaskRow[];
	projects: Array<Pick<ProjectRow, "id" | "name" | "language">>;
	initialProjectId: string;
	initialStatus: string;
}) {
	const [tasks] = useState(initialTasks);
	const [query, setQuery] = useState("");
	const [projectId, setProjectId] = useState(initialProjectId);
	const [status, setStatus] = useState(initialStatus || "all");

	const projectNames = useMemo(
		() => new Map(projects.map((project) => [project.id, project.name])),
		[projects],
	);

	const filtered = tasks.filter((task) => {
		if (projectId && task.project_id !== projectId) return false;
		if (status !== "all" && task.status !== status) return false;
		const term = query.trim().toLowerCase();
		if (!term) return true;
		return (
			task.title.toLowerCase().includes(term) ||
			task.prompt.toLowerCase().includes(term) ||
			task.model_id.toLowerCase().includes(term)
		);
	});

	return (
		<div className="space-y-6">
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="eyebrow">Tasks</p>
					<h1 className="display mt-2 text-3xl font-semibold">Agent runs</h1>
					<p className="mt-2 text-sm text-mist-500">
						Every task keeps its tool calls, terminal output, token usage and file changes.
					</p>
				</div>
				<Link href="/app/projects" className="btn btn-secondary">
					Open a project <ArrowUpRight className="size-3.5" />
				</Link>
			</header>

			<div className="surface flex flex-wrap items-end gap-3 p-3">
				<div className="relative min-w-[220px] flex-1">
					<Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-mist-600" />
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search tasks, prompts or models…"
						className="input pl-9"
					/>
				</div>
				<div className="w-full sm:w-48">
					<label className="label" htmlFor="task-project-filter">
						Project
					</label>
					<select
						id="task-project-filter"
						value={projectId}
						onChange={(event) => setProjectId(event.target.value)}
						className="input"
					>
						<option value="">All projects</option>
						{projects.map((project) => (
							<option key={project.id} value={project.id}>
								{project.name}
							</option>
						))}
					</select>
				</div>
			</div>

			<div className="flex flex-wrap gap-1.5">
				{STATUS_FILTERS.map((value) => (
					<button
						key={value}
						type="button"
						onClick={() => setStatus(value)}
						className={cn(
							"rounded-full border px-2.5 py-1 text-[0.6875rem] capitalize transition",
							status === value
								? "border-signal-500/30 bg-signal-500/10 text-signal-200"
								: "border-white/[0.07] bg-white/[0.02] text-mist-500 hover:border-white/15 hover:text-mist-200",
						)}
					>
						{value.replaceAll("_", " ")}
					</button>
				))}
			</div>

			{filtered.length === 0 ? (
				<EmptyState
					icon={TerminalSquare}
					title={tasks.length === 0 ? "No tasks yet" : "Nothing matches"}
					description={
						tasks.length === 0
							? "Open a project and describe a concrete change to start the first agent run."
							: "Adjust the filters or search term."
					}
					action={
						tasks.length === 0 ? (
							<Link href="/app/projects" className="btn btn-primary">
								Choose a project
							</Link>
						) : null
					}
				/>
			) : (
				<div className="surface overflow-hidden">
					<div className="hidden grid-cols-[minmax(0,2.2fr)_1fr_1fr_0.8fr_0.8fr_auto] gap-3 border-b border-white/[0.06] px-4 py-2.5 text-[0.6rem] uppercase tracking-[0.12em] text-mist-600 md:grid">
						<span>Task</span>
						<span>Project</span>
						<span>Model</span>
						<span>Files</span>
						<span>Usage</span>
						<span />
					</div>
					<div className="divide-y divide-white/[0.055]">
						{filtered.map((task) => (
							<Link
								key={task.id}
								href={`/app/tasks/${task.id}`}
								className="grid grid-cols-1 items-center gap-2 px-4 py-3.5 transition hover:bg-white/[0.022] md:grid-cols-[minmax(0,2.2fr)_1fr_1fr_0.8fr_0.8fr_auto]"
							>
								<div className="flex min-w-0 items-center gap-3">
									<span className="grid size-7 shrink-0 place-items-center rounded-md border border-white/[0.07] bg-white/[0.03] text-mist-500">
										<FileCode2 className="size-3.5" strokeWidth={1.7} />
									</span>
									<div className="min-w-0">
										<p className="truncate text-[0.8125rem] font-medium text-mist-100">
											{task.title}
										</p>
										<p className="mt-0.5 text-[0.65rem] text-mist-600">
											{formatRelativeTime(task.created_at)} · {task.iteration} iterations
										</p>
									</div>
								</div>
								<div className="flex items-center gap-2 text-[0.7rem] text-mist-400">
									<span className="md:hidden text-mist-600">Project:</span>
									<span className="truncate">{projectNames.get(task.project_id) ?? "—"}</span>
								</div>
								<div className="truncate font-mono text-[0.65rem] text-mist-500">
									{task.model_id}
								</div>
								<div className="text-[0.7rem] text-mist-400">{task.files_changed}</div>
								<div className="text-[0.7rem] text-mist-400">
									{formatCompact(
										(task.usage.inputTokens ?? 0) +
											(task.usage.outputTokens ?? 0) +
											(task.usage.cacheReadTokens ?? 0),
									)}{" "}
									<span className="text-mist-600">tok</span>
									<span className="ml-1 text-mist-600">{formatUsd(task.usage.costUsd ?? 0)}</span>
								</div>
								<div className="flex items-center justify-end gap-2">
									<StatusBadge status={task.status} />
								</div>
							</Link>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

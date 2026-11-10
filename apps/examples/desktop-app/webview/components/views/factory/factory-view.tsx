"use client";

import type { AgendaTaskRecord } from "@cline/shared";
import { createSessionId } from "@cline/shared/browser";
import {
	CheckCircle2,
	Columns3,
	Loader2,
	Pause,
	Play,
	Plus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { getInitialChatConfig } from "@/hooks/chat-session/constants";
import { useAgendaTasks } from "@/hooks/use-agenda-tasks";
import {
	type FactoryAttention,
	useFactoryAttention,
} from "@/hooks/use-factory-attention";
import { toast } from "@/hooks/use-toast";
import { desktopClient } from "@/lib/desktop-client";
import { LOCAL_WORKSPACE_ENVIRONMENT_ID } from "@/lib/workspace-paths";
import { PageFrame, PageHeader } from "../page-layout";
import { AddWork } from "./factory-add-work";
import {
	DEFAULT_FACTORY,
	FeatureDetail,
	type FactoryDraft,
} from "./factory-detail";
import { FactoryWorkflowEditor } from "./factory-workflow-editor";

const COLUMNS = ["Queued", "Working", "Needs you", "Done"] as const;
type FactoryDestination =
	| "attention"
	| "board"
	| "workflows"
	| "outcomes"
	| "samples"
	| "history"
	| "archived";

function savedDestination(): FactoryDestination {
	if (typeof window === "undefined") return "attention";
	const value = sessionStorage.getItem("factory.destination");
	switch (value) {
		case "board":
		case "workflows":
		case "history":
		case "outcomes":
		case "samples":
		case "archived":
			return value;
		default:
			return "attention";
	}
}
function factoryActivity(
	task: AgendaTaskRecord,
	attention: FactoryAttention | undefined,
): { column: (typeof COLUMNS)[number] | "Status unavailable"; label: string } {
	const state = attention?.outcome;
	const pendingQuestion =
		attention?.questions.length ||
		task.factoryQuestions?.some(
			(question) =>
				question.status === "pending" && question.revision === task.revision,
		);
	if (pendingQuestion)
		return { column: "Needs you", label: "Answer a question" };
	if (task.status === "failed" || task.error)
		return { column: "Needs you", label: "Resolve failure" };
	if (state?.audit?.finding)
		return { column: "Needs you", label: "Review sampled finding" };
	const design =
		task.factoryDesignProgress?.revision === task.revision
			? task.factoryDesignProgress
			: undefined;
	if (
		(task.status === "pending_approval" || task.status === "approved") &&
		design &&
		design.phase !== "complete"
	)
		return {
			column: "Working",
			label: design.phase === "designing" ? "Scoping" : "Reviewing plan",
		};
	if (attention?.needsAttention)
		return {
			column: "Needs you",
			label:
				state?.phase === "blocked"
					? "Resolve blocker"
					: state?.followupPaused
						? "Resume PR follow-up"
						: task.status === "pending_approval"
							? "Approve plan"
							: "Review result",
		};
	if (state?.humanApproval) return { column: "Done", label: "Checked off" };
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
	) {
		const roles = state?.activeRoles ?? [];
		const counts = [
			["builder", "implementer"],
			["verifier", "verifier"],
			["reviewer", "reviewer"],
		]
			.map(([role, label]) => {
				const count = roles.filter((active) => active === role).length;
				return count ? `${count} ${label}${count === 1 ? "" : "s"}` : "";
			})
			.filter(Boolean)
			.join(" · ");
		const label = state
			? {
					implementing: "Implementing",
					verifying: "Running checks",
					reviewing: "Agent code review",
					repairing: "Fixing findings",
					publishing: "Publishing draft PR",
					watching: "Waiting for CI / PR follow-up",
					ready: "Finishing execution",
					blocked: "Blocked",
				}[state.phase]
			: "Starting execution";
		return {
			column: "Working",
			label: counts ? `${label} · ${counts}` : label,
		};
	}
	if (!attention || task.status === "completed")
		return {
			column: "Status unavailable",
			label: "Current activity unavailable",
		};
	return {
		column: "Queued",
		label:
			task.status === "approved" ||
			(design?.phase === "complete" && task.factory?.approval === "automatic")
				? "Queued for implementation"
				: "Queued for scoping",
	};
}

export function FactoryView({
	drafts,
	onOpenSession,
	workspacePaths,
}: {
	drafts: Map<string, FactoryDraft>;
	onOpenSession: (
		sessionId: string,
		initialPromptDraft?: string,
	) => Promise<void>;
	workspacePaths: string[];
}) {
	const agenda = useAgendaTasks({
		allWorkspaces: true,
		includeArchived: true,
		limit: 200,
	});
	const tasks = agenda.tasks.filter((task) => task.factory);
	const attention = useFactoryAttention();
	const [needsYouOnly, setNeedsYouOnly] = useState(
		() =>
			typeof window !== "undefined" &&
			sessionStorage.getItem("factory.needsYouOnly") === "true",
	);
	const [view, setView] = useState<FactoryDestination>(savedDestination);
	useEffect(() => {
		sessionStorage.setItem("factory.destination", view);
		sessionStorage.setItem("factory.needsYouOnly", String(needsYouOnly));
	}, [view, needsYouOnly]);
	const showArchived = view === "archived";
	const showOutcomes =
		view === "outcomes" || view === "samples" || view === "history";
	const samplesOnly = view === "samples";
	const activeDestination =
		view === "history" || view === "archived"
			? "board"
			: view === "outcomes"
				? "samples"
				: view;
	const tasksById = new Map(tasks.map((task) => [task.taskId, task]));
	const currentAttention = new Map(
		attention.items
			.filter((item) => {
				const task = tasksById.get(item.taskId);
				return (
					attention.transportReady &&
					attention.hasLoaded &&
					!attention.error &&
					!agenda.error &&
					task?.revision === item.revision &&
					(!item.outcome ||
						item.runId === (task.currentRunId ?? task.lastRunId))
				);
			})
			.map((item) => [item.taskId, item]),
	);
	const boardTasks = tasks.filter(
		(task) =>
			!task.archivedAt &&
			task.status !== "cancelled" &&
			task.status !== "expired",
	);
	const activities = new Map(
		boardTasks.map((task) => [
			task.taskId,
			factoryActivity(task, currentAttention.get(task.taskId)),
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
	const sampleQueue = finished.filter((task) => {
		const audit = outcomes.get(task.taskId)?.audit;
		return audit && !audit.reviewedAt;
	});
	const needsYou = (task: AgendaTaskRecord) =>
		activities.get(task.taskId)?.column === "Needs you";
	const attentionCount = boardTasks.filter(needsYou).length;
	const visibleOutcomes = showArchived
		? archived
		: samplesOnly
			? sampleQueue
			: finished;
	const [selectedId, setSelectedId] = useState<string | null>(() =>
		typeof window === "undefined"
			? null
			: sessionStorage.getItem("factory.selectedTask"),
	);
	const [creating, setCreating] = useState(false);
	const [workflowConfig, setWorkflowConfig] = useState(() =>
		structuredClone(DEFAULT_FACTORY),
	);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const selected = tasks.find((task) => task.taskId === selectedId);
	const ready = tasks
		.filter((task) => !task.archivedAt)
		.filter(
			(task) =>
				(task.status === "approved" &&
					activities.get(task.taskId)?.column === "Queued") ||
				(task.status === "pending_approval" &&
					task.factory?.approval === "automatic" &&
					task.factory.checks.length > 0 &&
					activities.get(task.taskId)?.column === "Queued" &&
					(!task.factoryDesignProgress ||
						task.factoryDesignProgress.phase === "complete")),
		);
	const attentionGroups = new Map<string, AgendaTaskRecord[]>();
	for (const task of boardTasks.filter(needsYou)) {
		const label = activities.get(task.taskId)?.label;
		if (!label) continue;
		const group = attentionGroups.get(label) ?? [];
		group.push(task);
		attentionGroups.set(label, group);
	}
	const unknownTasks = boardTasks.filter(
		(task) => activities.get(task.taskId)?.column === "Status unavailable",
	);
	const running = boardTasks.filter(
		(task) => activities.get(task.taskId)?.column === "Working",
	).length;
	const selectTask = (id: string | null) => {
		setSelectedId(id);
		if (id) sessionStorage.setItem("factory.selectedTask", id);
		else sessionStorage.removeItem("factory.selectedTask");
	};
	async function perform(action: () => Promise<void>) {
		setBusy(true);
		setError(null);
		setMessage(null);
		try {
			await action();
			await agenda.refresh();
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Unable to update factory.",
			);
		} finally {
			setBusy(false);
		}
	}
	const feedback = (
		<>
			{error || agenda.error || attention.error || !attention.transportReady ? (
				<p
					role="alert"
					className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
				>
					{error ||
						agenda.error ||
						attention.error ||
						"Factory connection is not ready."}
					{attention.error || !attention.transportReady
						? " Questions and current activity could not be confirmed."
						: ""}
					<Button
						variant="outline"
						size="sm"
						className="ml-3"
						disabled={busy}
						onClick={() => {
							void agenda.refresh();
							void attention.refresh();
						}}
					>
						Retry current activity
					</Button>
				</p>
			) : null}
			{message ? (
				<output className="mb-3 rounded-md border p-3 text-sm">
					{message}
				</output>
			) : null}
		</>
	);
	if (selectedId) {
		return (
			<div className="min-h-0 flex-1" data-testid="factory-view">
				<PageFrame key={selectedId}>
					{feedback}
					{selected ? (
						<FeatureDetail
							drafts={drafts}
							key={selected.taskId}
							task={selected}
							onRefresh={agenda.refresh}
							onOpenSession={onOpenSession}
							onClose={() => selectTask(null)}
							questions={currentAttention.get(selected.taskId)?.questions ?? []}
							onAnswer={attention.answer}
						/>
					) : (
						<>
							<Button variant="ghost" onClick={() => selectTask(null)}>
								Back to Factory
							</Button>
							<output className="mt-4 text-sm text-muted-foreground">
								{agenda.isLoading
									? "Loading work…"
									: "This work is not in the loaded history. Return to Factory to choose another item."}
							</output>
						</>
					)}
				</PageFrame>
			</div>
		);
	}
	return (
		<div className="min-h-0 flex-1" data-testid="factory-view">
			<PageFrame key={view}>
				<PageHeader
					title="Factory"
					icon={Columns3}
					description="Local agents scope, implement, verify, and repair your requests. Review the decisions that need you."
					meta={
						<span className="rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
							Preview
						</span>
					}
					actions={
						<>
							<Button
								variant="outline"
								disabled={busy}
								onClick={() =>
									void perform(async () => {
										await desktopClient.stopFactoryQueue();
										setMessage(
											"Queue stopped. A running feature continues; cancel it from its details to stop execution.",
										);
									})
								}
							>
								<Pause className="mr-2 size-3.5" />
								Stop queue
							</Button>
							<Button
								variant="outline"
								disabled={
									busy ||
									ready.length === 0 ||
									agenda.isLoading ||
									attention.isLoading ||
									!attention.transportReady
								}
								onClick={() =>
									void perform(async () => {
										const result = await desktopClient.startFactoryQueue(ready);
										setMessage(
											`${result.queued} feature${result.queued === 1 ? "" : "s"} queued. Independent jobs can run concurrently.`,
										);
									})
								}
							>
								<Play className="mr-2 size-3.5" />
								Start queue{ready.length ? ` (${ready.length})` : ""}
							</Button>
							<Button onClick={() => setCreating(true)}>
								<Plus className="mr-2 size-4" />
								Add work
							</Button>
						</>
					}
				/>

				<nav
					aria-label="Factory destinations"
					className="mb-6 flex flex-wrap gap-1 border-b pb-3"
				>
					{(
						[
							["attention", "Attention"],
							["board", "Runs"],
							["workflows", "Workflows"],
							["samples", "Improve"],
						] satisfies [FactoryDestination, string][]
					).map(([destination, label]) => (
						<Button
							key={destination}
							size="sm"
							variant={
								activeDestination === destination ? "secondary" : "ghost"
							}
							aria-current={
								activeDestination === destination ? "page" : undefined
							}
							onClick={() => setView(destination)}
						>
							{label}
							{destination === "attention" && attentionCount
								? ` (${attentionCount})`
								: ""}
						</Button>
					))}
				</nav>
				{feedback}
				{view === "board" || showArchived || showOutcomes ? (
					<div className="mb-4 flex flex-wrap items-center gap-2">
						{view === "board" || showArchived || view === "history" ? (
							<>
								<Button
									size="sm"
									variant={view === "board" ? "secondary" : "ghost"}
									onClick={() => setView("board")}
								>
									Active runs
								</Button>
								<Button
									size="sm"
									variant={view === "history" ? "secondary" : "ghost"}
									onClick={() => setView("history")}
								>
									History ({finished.length})
								</Button>
								<Button
									size="sm"
									variant={showArchived ? "secondary" : "ghost"}
									onClick={() => setView("archived")}
								>
									Archived ({archived.length})
								</Button>
								{view === "board" ? (
									<Button
										size="sm"
										variant={needsYouOnly ? "secondary" : "ghost"}
										aria-pressed={needsYouOnly}
										onClick={() => setNeedsYouOnly((current) => !current)}
									>
										Needs you ({attentionCount})
									</Button>
								) : null}
							</>
						) : (
							<>
								<Button
									size="sm"
									variant={samplesOnly ? "secondary" : "ghost"}
									onClick={() => setView("samples")}
								>
									Sample queue ({sampleQueue.length})
								</Button>
								<Button
									size="sm"
									variant={view === "outcomes" ? "secondary" : "ghost"}
									onClick={() => setView("outcomes")}
								>
									Outcomes ({finished.length})
								</Button>
							</>
						)}
					</div>
				) : null}
				{showOutcomes && view !== "history" ? (
					<div className="mb-4">
						<Button
							size="sm"
							variant="outline"
							disabled={
								busy ||
								!finished.some(
									(task) =>
										outcomes.get(task.taskId) &&
										!outcomes.get(task.taskId)?.audit,
								)
							}
							onClick={() =>
								void perform(async () => {
									const eligible = finished.filter(
										(task) =>
											outcomes.get(task.taskId) &&
											!outcomes.get(task.taskId)?.audit,
									);
									const task =
										eligible[Math.floor(Math.random() * eligible.length)];
									if (!task) return;
									await desktopClient.invoke("task.factory.audit", {
										taskId: task.taskId,
										selectionReason: "random",
										allWorkspaces: true,
									});
									await attention.refresh();
									setView("samples");
								})
							}
						>
							Pick a random outcome
						</Button>
					</div>
				) : null}

				{showOutcomes || showArchived ? (
					<div className="overflow-x-auto pb-6">
						<p className="mb-3 text-xs text-muted-foreground">
							{showArchived ? (
								"Archived work is kept here. Open a feature to restore or delete it."
							) : (
								<>
									Recent loaded outcomes, including failures. Random selection
									draws from unsampled outcomes with execution evidence in this
									view; manual samples are recorded separately.
								</>
							)}
						</p>
						<table className="w-full text-left text-sm">
							<thead>
								<tr className="border-b">
									<th className="p-2">Feature</th>
									<th className="p-2">{showArchived ? "Status" : "Outcome"}</th>
									{showArchived ? (
										<th className="p-2">Archived</th>
									) : (
										<>
											<th className="p-2">Recorded model cost</th>
											<th className="p-2">Repairs</th>
											<th className="p-2">Sample</th>
										</>
									)}
								</tr>
							</thead>
							<tbody>
								{visibleOutcomes.map((task) => {
									const outcome = outcomes.get(task.taskId);
									return (
										<tr key={task.taskId} className="border-b">
											<td className="p-2">
												<button
													type="button"
													className="text-left underline underline-offset-4"
													onClick={() => selectTask(task.taskId)}
												>
													{task.title}
												</button>
											</td>
											<td className="p-2">
												{showArchived ||
												task.status === "cancelled" ||
												task.status === "expired"
													? task.status
													: outcome?.humanApproval
														? "Checked off"
														: (outcome?.phase ?? task.status)}
											</td>
											{showArchived ? (
												<td className="p-2">
													{task.archivedAt
														? new Date(task.archivedAt).toLocaleString()
														: "—"}
												</td>
											) : (
												<>
													<td className="p-2">
														{outcome?.usage
															? `$${outcome.usage.totals.totalCost.toFixed(2)}${outcome.usage.unknownSessionIds.length ? " + unknown usage" : ""}`
															: "Unknown"}
													</td>
													<td className="p-2">{outcome?.repairRound ?? "—"}</td>
													<td className="p-2">
														{outcome?.audit
															? `${outcome.audit.selectionReason ?? "manual"} · ${outcome.audit.reviewedAt ? (outcome.audit.finding ? "finding" : "passed") : "pending"}`
															: outcome
																? "Not sampled"
																: "Unknown"}
													</td>
												</>
											)}
										</tr>
									);
								})}
							</tbody>
						</table>
						{visibleOutcomes.length === 0 ? (
							<p className="py-8 text-sm text-muted-foreground">
								{showArchived
									? "No archived work."
									: !attention.hasLoaded || attention.error || agenda.error
										? "Current outcome and sample status is unavailable."
										: samplesOnly
											? "No samples waiting for review in loaded work."
											: "No finished outcomes yet."}
							</p>
						) : null}
					</div>
				) : null}
				{(view === "attention" || (view === "board" && !needsYouOnly)) &&
				unknownTasks.length > 0 ? (
					<section
						aria-label="Status unavailable"
						className="mb-5 rounded-lg border border-dashed p-4"
					>
						<h2 className="text-sm font-medium">
							Status unavailable ({unknownTasks.length})
						</h2>
						<p className="mt-1 text-xs text-muted-foreground">
							Current activity has not been confirmed. Open work to inspect its
							latest state.
						</p>
						<div className="mt-3 flex flex-wrap gap-2">
							{unknownTasks.map((task) => (
								<Button
									key={task.taskId}
									size="sm"
									variant="outline"
									onClick={() => selectTask(task.taskId)}
								>
									{task.title}
								</Button>
							))}
						</div>
					</section>
				) : null}
				{view === "attention" ? (
					<div className="space-y-5">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div>
								<h2 className="text-lg font-medium">Decisions waiting</h2>
								<p className="mt-1 text-sm text-muted-foreground">
									Questions, plan approvals, and results in your loaded work.
								</p>
							</div>
							<Button
								variant="outline"
								size="sm"
								onClick={() => setView("board")}
							>
								{running} working · View runs
							</Button>
						</div>
						{(agenda.isLoading && tasks.length === 0) ||
						(!attention.hasLoaded && attention.isLoading) ? (
							<output className="flex items-center gap-2 text-sm text-muted-foreground">
								<Loader2 className="size-4 animate-spin" />
								Loading current activity…
							</output>
						) : null}
						{[...attentionGroups].map(([label, items]) => (
							<section
								key={label}
								aria-label={label}
								className="overflow-hidden rounded-lg border"
							>
								<h3 className="border-b bg-muted/20 px-4 py-3 text-sm font-medium">
									{label}{" "}
									<span className="ml-1 text-muted-foreground">
										{items.length}
									</span>
								</h3>
								<ul className="divide-y">
									{items.map((task) => (
										<li key={task.taskId}>
											<button
												type="button"
												onClick={() => selectTask(task.taskId)}
												className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
											>
												<span className="min-w-0 flex-1">
													<span className="block text-sm font-medium">
														{task.title}
													</span>
													<span className="mt-1 line-clamp-2 text-xs text-muted-foreground">
														{task.workspaceRoot
															?.split("/")
															.filter(Boolean)
															.pop() || "Repository"}
														{task.description ? ` · ${task.description}` : ""}
													</span>
												</span>
												<span className="text-xs text-muted-foreground">
													Open work →
												</span>
											</button>
										</li>
									))}
								</ul>
							</section>
						))}
						{attentionCount === 0 &&
						unknownTasks.length === 0 &&
						attention.hasLoaded &&
						attention.transportReady &&
						!attention.isLoading &&
						!agenda.isLoading &&
						!agenda.error &&
						!attention.error ? (
							<p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
								No decisions waiting in loaded work. Follow progress in Runs or
								add work to begin.
							</p>
						) : null}
					</div>
				) : null}
				{view === "workflows" ? (
					<section className="max-w-4xl">
						<h2 className="text-lg font-medium">Factory workflows</h2>
						<p className="mb-6 mt-2 text-sm text-muted-foreground">
							Configure reusable participants and policies, save a named preset,
							and choose the default for new work.
						</p>
						<FactoryWorkflowEditor
							config={workflowConfig}
							onChange={setWorkflowConfig}
							disabled={false}
							standalone
						/>
					</section>
				) : null}
				{view === "board" ? (
					<>
						<p className="mb-4 text-xs text-muted-foreground">
							{running} working · Local execution · Draft PRs require opt-in ·
							Loaded work only
						</p>
						{agenda.isLoading && tasks.length === 0 ? (
							<output className="p-6 text-sm text-muted-foreground">
								Loading features…
							</output>
						) : (
							<div className="grid min-h-80 grid-cols-1 gap-4 pb-6 md:grid-cols-2 xl:grid-cols-4">
								{COLUMNS.map((column) => {
									const items = boardTasks.filter(
										(task) =>
											activities.get(task.taskId)?.column === column &&
											(!needsYouOnly || needsYou(task)),
									);
									return (
										<section
											key={column}
											aria-label={column}
											className="rounded-xl border bg-muted/15 p-3"
										>
											<div className="mb-4 flex items-center justify-between px-1">
												<h2 className="text-sm font-medium">{column}</h2>
												<span className="text-xs tabular-nums text-muted-foreground">
													{items.length}
												</span>
											</div>
											<div className="space-y-3">
												{items.map((task) => (
													<button
														key={task.taskId}
														type="button"
														onClick={() => selectTask(task.taskId)}
														className="w-full rounded-lg border bg-background p-4 text-left shadow-sm transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
													>
														<div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
															<span className="truncate">
																{task.workspaceRoot
																	?.split("/")
																	.filter(Boolean)
																	.pop() || "Repository"}
															</span>
															{needsYou(task) ? (
																<span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-600 dark:text-amber-400">
																	Needs you
																</span>
															) : null}
														</div>
														<h3 className="text-sm font-medium leading-5">
															{task.title}
														</h3>
														<p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
															{task.description || task.instructions}
														</p>
														<div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
															{column === "Working" ? (
																<Loader2 className="size-3 animate-spin" />
															) : column === "Done" ? (
																<CheckCircle2 className="size-3 text-emerald-500" />
															) : null}
															<span>{activities.get(task.taskId)?.label}</span>
														</div>
													</button>
												))}
												{items.length === 0 ? (
													<p className="rounded-lg border border-dashed px-3 py-8 text-center text-xs leading-5 text-muted-foreground">
														{column === "Queued"
															? "Features waiting to start."
															: column === "Needs you"
																? "Questions, approvals, and blockers appear here."
																: column === "Working"
																	? "Implementation, tests, review, and repairs."
																	: "Features you have stamped appear here."}
													</p>
												) : null}
											</div>
										</section>
									);
								})}
							</div>
						)}
					</>
				) : null}

				<Dialog open={creating} onOpenChange={setCreating}>
					<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
						<DialogHeader>
							<DialogTitle>Add work</DialogTitle>
							<DialogDescription>
								Describe a request or import a GitHub or Linear issue. Add it to
								the queue, or start scoping it with an agent.
							</DialogDescription>
						</DialogHeader>
						<AddWork
							workspacePaths={workspacePaths}
							onExisting={(taskId) => {
								setCreating(false);
								selectTask(taskId);
							}}
							onCreate={async ({
								title,
								request,
								workspaceRoot,
								sourceIssue,
								startScoping,
								workflow,
							}) => {
								const model = getInitialChatConfig(
									LOCAL_WORKSPACE_ENVIRONMENT_ID,
									{ executionTarget: "local" },
								);
								const requestedTaskId = createSessionId("task_");
								const task = await agenda.createTask({
									taskId: requestedTaskId,
									type: "todo",
									title,
									description: request,
									instructions: request,
									scope: "workspace",
									allWorkspaces: true,
									workspaceRoot,
									cwd: workspaceRoot,
									queueFactoryDesign: startScoping,
									factory: structuredClone({
										...DEFAULT_FACTORY,
										...workflow,
										sourceIssue,
									}),
									modelSelection: {
										providerId: model.provider,
										modelId: model.model,
									},
									expiresAt: new Date(
										Date.now() + 90 * 86_400_000,
									).toISOString(),
									automationEligible: false,
								});
								setCreating(false);
								selectTask(task.taskId);
								if (startScoping && task.taskId === requestedTaskId) {
									try {
										await desktopClient.designFactoryTask(task.taskId);
									} catch (cause) {
										const message = `Work was added, but scoping could not start: ${cause instanceof Error ? cause.message : "Open the plan to retry."}`;
										setError(message);
										toast({
											title: "Scoping could not start",
											description: message,
											variant: "destructive",
										});
									}
								}
							}}
						/>
					</DialogContent>
				</Dialog>
			</PageFrame>
		</div>
	);
}

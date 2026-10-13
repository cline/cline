"use client";

import type { AgendaTaskRecord, FactoryTaskConfig } from "@cline/shared";
import {
	CheckCircle2,
	Columns3,
	FolderOpen,
	Loader2,
	Pause,
	Play,
	Plus,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getInitialChatConfig } from "@/hooks/chat-session/constants";
import { useAgendaTasks } from "@/hooks/use-agenda-tasks";
import { useFactoryAttention } from "@/hooks/use-factory-attention";
import { desktopClient } from "@/lib/desktop-client";
import { LOCAL_WORKSPACE_ENVIRONMENT_ID } from "@/lib/workspace-paths";
import { DEFAULT_FACTORY, FeatureDetail } from "./factory-detail";

const COLUMNS = ["Backlog", "Design", "Running", "Review"] as const;
export function factoryColumn(
	task: AgendaTaskRecord,
): (typeof COLUMNS)[number] {
	switch (task.status) {
		case "in_progress":
			return "Running";
		case "completed":
			return "Review";
		case "pending_approval":
			return task.factory?.approval === "automatic" ? "Backlog" : "Design";
		case "failed":
			return "Design";
		case "approved":
		case "cancelled":
		case "expired":
			return "Backlog";
	}
}
const labelClass = "block space-y-2 text-sm font-medium";

export function FactoryView({
	onOpenSession,
	workspacePaths,
}: {
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
	const [needsYouOnly, setNeedsYouOnly] = useState(false);
	const needsYou = (task: AgendaTaskRecord) =>
		attention.items.some(
			(item) => item.taskId === task.taskId && item.needsAttention,
		);
	const attentionCount = tasks.filter(needsYou).length;
	const [selectedId, setSelectedId] = useState<string | null>(() =>
		typeof window === "undefined"
			? null
			: sessionStorage.getItem("factory.selectedTask"),
	);
	const [creating, setCreating] = useState(false);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const selected = tasks.find((task) => task.taskId === selectedId);
	const ready = tasks.filter(
		(task) =>
			task.status === "approved" ||
			(task.status === "pending_approval" &&
				task.factory?.approval === "automatic" &&
				task.factory.checks.length > 0),
	);
	const running = tasks.filter((task) => task.status === "in_progress").length;
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
	return (
		<div
			className="flex min-h-0 flex-1 flex-col overflow-auto"
			data-testid="factory-view"
		>
			<header className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-5">
				<div>
					<div className="flex items-center gap-2">
						<Columns3 className="size-5 text-muted-foreground" />
						<h1 className="text-xl font-semibold">Factory</h1>
						<span className="rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
							Preview
						</span>
					</div>
					<p className="mt-1 text-sm text-muted-foreground">
						One feature, from a clear brief to tested changes.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
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
						disabled={busy || ready.length === 0}
						onClick={() =>
							void perform(async () => {
								const result = await desktopClient.startFactoryQueue(ready);
								setMessage(
									`${result.queued} feature${result.queued === 1 ? "" : "s"} queued. One runs at a time.`,
								);
							})
						}
					>
						<Play className="mr-2 size-3.5" />
						Start queue{ready.length ? ` (${ready.length})` : ""}
					</Button>
					<Button onClick={() => setCreating(true)}>
						<Plus className="mr-2 size-4" />
						New feature
					</Button>
				</div>
			</header>
			<div className="flex items-center gap-3 px-6 py-3 text-xs text-muted-foreground">
				<span className="size-1.5 rounded-full bg-emerald-500" />
				Local execution<span>·</span>
				<span>{running} running</span>
				<span>·</span>
				<span>Draft PRs require opt-in</span>
				<Button
					variant={needsYouOnly ? "secondary" : "ghost"}
					size="sm"
					className="ml-auto"
					aria-pressed={needsYouOnly}
					onClick={() => setNeedsYouOnly((current) => !current)}
				>
					Needs you ({attentionCount})
				</Button>
			</div>
			{error || agenda.error || attention.error ? (
				<p
					role="alert"
					className="mx-6 mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
				>
					{error || agenda.error || attention.error}
				</p>
			) : null}
			{message ? (
				<output className="mx-6 mb-3 rounded-md border p-3 text-sm">
					{message}
				</output>
			) : null}
			{agenda.isLoading && tasks.length === 0 ? (
				<div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
					<Loader2 className="size-4 animate-spin" />
					Loading features…
				</div>
			) : (
				<div className="grid min-h-80 grid-cols-1 gap-4 px-6 pb-6 md:grid-cols-2 xl:grid-cols-4">
					{COLUMNS.map((column) => {
						const items = tasks.filter(
							(task) =>
								factoryColumn(task) === column &&
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
												{task.status === "in_progress" ? (
													<Loader2 className="size-3 animate-spin" />
												) : task.status === "completed" ? (
													<CheckCircle2 className="size-3 text-emerald-500" />
												) : null}
												<span>
													{task.status === "completed"
														? "Review changes"
														: task.status.replaceAll("_", " ")}
												</span>
											</div>
										</button>
									))}
									{items.length === 0 ? (
										<p className="rounded-lg border border-dashed px-3 py-8 text-center text-xs leading-5 text-muted-foreground">
											{column === "Backlog"
												? "Approved features wait here."
												: column === "Design"
													? "Clarify scope and approve the checks."
													: column === "Running"
														? "Implementation, tests, review, and repairs."
														: "Verified changes arrive here for your review."}
										</p>
									) : null}
								</div>
							</section>
						);
					})}
				</div>
			)}
			<Dialog open={creating} onOpenChange={setCreating}>
				<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
					<DialogHeader>
						<DialogTitle>Start with a feature request</DialogTitle>
						<DialogDescription>
							Explore the design with an agent, then approve the brief and
							checks before implementation.
						</DialogDescription>
					</DialogHeader>
					<NewFeature
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
						}) => {
							const model = getInitialChatConfig(
								LOCAL_WORKSPACE_ENVIRONMENT_ID,
								{ executionTarget: "local" },
							);
							const task = await agenda.createTask({
								type: "todo",
								title,
								description: request,
								instructions: request,
								scope: "workspace",
								allWorkspaces: true,
								workspaceRoot,
								cwd: workspaceRoot,
								factory: { ...DEFAULT_FACTORY, sourceIssue },
								modelSelection: {
									providerId: model.provider,
									modelId: model.model,
								},
								expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
								automationEligible: false,
							});
							setCreating(false);
							selectTask(task.taskId);
						}}
					/>
				</DialogContent>
			</Dialog>
			<Dialog
				open={Boolean(selected)}
				onOpenChange={(open) => {
					if (!open) selectTask(null);
				}}
			>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
					{selected ? (
						<FeatureDetail
							key={selected.taskId}
							task={selected}
							onRefresh={agenda.refresh}
							onOpenSession={onOpenSession}
							questions={
								attention.items.find((item) => item.taskId === selected.taskId)
									?.questions ?? []
							}
							onAnswer={attention.answer}
						/>
					) : (
						<DialogTitle>Feature</DialogTitle>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}

function NewFeature({
	workspacePaths,
	onCreate,
	onExisting,
}: {
	workspacePaths: string[];
	onExisting: (taskId: string) => void;
	onCreate: (input: {
		title: string;
		request: string;
		workspaceRoot: string;
		sourceIssue?: FactoryTaskConfig["sourceIssue"];
	}) => Promise<void>;
}) {
	const [title, setTitle] = useState("");
	const [request, setRequest] = useState("");
	const [workspaceRoot, setWorkspaceRoot] = useState(workspacePaths[0] || "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [issueUrl, setIssueUrl] = useState("");
	const [sourceIssue, setSourceIssue] =
		useState<FactoryTaskConfig["sourceIssue"]>();
	return (
		<form
			className="space-y-5"
			onSubmit={(event) => {
				event.preventDefault();
				setBusy(true);
				setError(null);
				void onCreate({
					title: title.trim(),
					request: request.trim(),
					workspaceRoot: workspaceRoot.trim(),
					sourceIssue,
				})
					.catch((cause: unknown) =>
						setError(
							cause instanceof Error
								? cause.message
								: "Unable to create feature.",
						),
					)
					.finally(() => setBusy(false));
			}}
		>
			<div className="space-y-2 rounded-lg border p-3">
				<label className={labelClass} htmlFor="feature-issue">
					Start from a GitHub or Linear issue
				</label>
				<div className="flex gap-2">
					<Input
						id="feature-issue"
						type="url"
						placeholder="Paste issue URL"
						value={issueUrl}
						disabled={busy}
						onChange={(event) => {
							setIssueUrl(event.target.value);
							setSourceIssue(undefined);
						}}
					/>
					<Button
						type="button"
						variant="outline"
						disabled={busy || !issueUrl.trim() || !workspaceRoot.trim()}
						onClick={() => {
							setBusy(true);
							setError(null);
							void desktopClient
								.invoke<{
									title: string;
									description: string;
									source: NonNullable<FactoryTaskConfig["sourceIssue"]>;
									existingTaskId?: string;
								}>("factory_import_issue", {
									url: issueUrl.trim(),
									cwd: workspaceRoot.trim(),
								})
								.then((issue) => {
									if (issue.existingTaskId) {
										onExisting(issue.existingTaskId);
										return;
									}
									setTitle(issue.title);
									setRequest(issue.description);
									setSourceIssue(issue.source);
								})
								.catch((cause: unknown) =>
									setError(
										cause instanceof Error
											? cause.message
											: "Unable to import issue.",
									),
								)
								.finally(() => setBusy(false));
						}}
					>
						Import
					</Button>
				</div>
				<p className="text-xs text-muted-foreground">
					Choose the repository below, then import with your existing
					connection. You can edit the request before creating it.
				</p>
				{sourceIssue ? (
					<output className="block text-xs text-emerald-600">
						Issue imported. Its source link will stay with the feature.
					</output>
				) : null}
			</div>
			<label className={labelClass} htmlFor="feature-name">
				Feature name
				<Input
					id="feature-name"
					required
					maxLength={200}
					value={title}
					onChange={(event) => setTitle(event.target.value)}
					placeholder="Add export to the activity view"
				/>
			</label>
			<label className={labelClass} htmlFor="feature-request">
				What should change?
				<Textarea
					id="feature-request"
					required
					rows={5}
					value={request}
					onChange={(event) => setRequest(event.target.value)}
					placeholder="Describe the outcome and who needs it. The design interview will help clarify the rest."
				/>
			</label>
			<label className={labelClass} htmlFor="feature-repository">
				Repository
				<div className="flex gap-2">
					<Input
						required
						id="feature-repository"
						list="factory-workspaces"
						value={workspaceRoot}
						onChange={(event) => setWorkspaceRoot(event.target.value)}
						placeholder="/path/to/repository"
					/>
					<Button
						type="button"
						variant="outline"
						aria-label="Choose repository"
						onClick={() => {
							void desktopClient
								.invoke<string | null>("pick_workspace_directory", {
									initialPath: workspaceRoot,
								})
								.then((path) => {
									if (path) setWorkspaceRoot(path);
								})
								.catch((cause: unknown) =>
									setError(
										cause instanceof Error
											? cause.message
											: "Unable to open picker. Enter a path.",
									),
								);
						}}
					>
						<FolderOpen className="size-4" />
					</Button>
				</div>
				<datalist id="factory-workspaces">
					{workspacePaths.map((path) => (
						<option key={path} value={path} />
					))}
				</datalist>
			</label>
			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : null}
			<Button
				disabled={
					busy || !title.trim() || !request.trim() || !workspaceRoot.trim()
				}
				type="submit"
				className="w-full"
			>
				{busy ? "Creating…" : "Create feature"}
			</Button>
		</form>
	);
}

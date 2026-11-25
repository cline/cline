"use client";

import {
	AlertTriangle,
	ArrowLeft,
	ArrowUpRight,
	Bot,
	CheckCircle2,
	ChevronDown,
	CircleDot,
	Cpu,
	FileCode2,
	GitCompareArrows,
	Hammer,
	Loader2,
	MessageSquare,
	Play,
	RefreshCw,
	Square,
	Terminal,
	User,
	Wrench,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, EmptyState, InlineAlert, StatusBadge } from "@/components/ui";
import { ApiClientError, apiFetch } from "@/lib/client-api";
import type {
	ApprovalRow,
	FileChangeRow,
	MessageRow,
	ProjectRow,
	TaskEventRow,
	TaskRow,
	TaskStatus,
} from "@/lib/types";
import {
	cn,
	formatCompact,
	formatDateTime,
	formatRelativeTime,
	formatUsd,
	humanizeStatus,
} from "@/lib/utils";

const ACTIVE: TaskStatus[] = ["queued", "provisioning", "running", "waiting_approval"];

type Snapshot = {
	status: TaskStatus;
	progress: number;
	iteration: number;
	cancel_requested: boolean;
	files_changed: number;
	summary: string | null;
	error: string | null;
	usage: Record<string, number>;
};

export function TaskLiveView({
	initialTask,
	project,
	initialEvents,
	initialCursor,
	initialMessages,
	initialApprovals,
	initialChanges,
}: {
	initialTask: TaskRow;
	project: ProjectRow;
	initialEvents: TaskEventRow[];
	initialCursor: number;
	initialMessages: MessageRow[];
	initialApprovals: ApprovalRow[];
	initialChanges: FileChangeRow[];
}) {
	const router = useRouter();
	const [task, setTask] = useState(initialTask);
	const [events, setEvents] = useState(initialEvents);
	const [messages, setMessages] = useState(initialMessages);
	const [approvals, setApprovals] = useState(initialApprovals);
	const [changes, setChanges] = useState(initialChanges);
	const [cursor, setCursor] = useState(initialCursor);
	const [tab, setTab] = useState<"activity" | "conversation" | "changes">("activity");
	const [pollError, setPollError] = useState<string | null>(null);
	const [cancelling, setCancelling] = useState(false);
	const [cancelError, setCancelError] = useState<string | null>(null);
	const [deciding, setDeciding] = useState<string | null>(null);
	const [decisionNote, setDecisionNote] = useState("");
	const [decisionError, setDecisionError] = useState<string | null>(null);
	const [loadingChanges, setLoadingChanges] = useState(false);
	const cursorRef = useRef(cursor);

	const active = ACTIVE.includes(task.status);

	useEffect(() => {
		cursorRef.current = cursor;
	}, [cursor]);

	const refresh = useCallback(async () => {
		try {
			const data = await apiFetch<{
				events: TaskEventRow[];
				cursor: number;
				messages: MessageRow[];
				approvals: ApprovalRow[];
				task: Snapshot;
			}>(`/api/tasks/${task.id}/events?after=${cursorRef.current}&limit=300`);
			if (data.events.length > 0) {
				setEvents((current) => [...current, ...data.events]);
			}
			setCursor(data.cursor);
			cursorRef.current = data.cursor;
			setMessages(data.messages);
			setApprovals(data.approvals);
			setTask((current) => ({
				...current,
				status: data.task.status,
				progress: data.task.progress,
				iteration: data.task.iteration,
				cancel_requested: data.task.cancel_requested,
				files_changed: data.task.files_changed,
				summary: data.task.summary,
				error: data.task.error,
				usage: data.task.usage,
			}));
			setPollError(null);
		} catch (caught) {
			setPollError(caught instanceof ApiClientError ? caught.message : "Live updates paused.");
		}
	}, [task.id]);

	useEffect(() => {
		if (!ACTIVE.includes(task.status)) return;
		const interval = setInterval(() => {
			void refresh();
		}, 2200);
		return () => clearInterval(interval);
	}, [task.status, refresh]);

	useEffect(() => {
		if (tab === "changes" && changes.length === 0 && task.files_changed > 0) {
			setLoadingChanges(true);
			apiFetch<{ changes: FileChangeRow[] }>(`/api/projects/${project.id}/diffs?taskId=${task.id}`)
				.then((data) => setChanges(data.changes))
				.catch(() => undefined)
				.finally(() => setLoadingChanges(false));
		}
	}, [tab, changes.length, task.files_changed, project.id, task.id]);

	async function cancelTask() {
		setCancelling(true);
		setCancelError(null);
		try {
			await apiFetch(`/api/tasks/${task.id}/cancel`, { method: "POST" });
			await refresh();
			router.refresh();
		} catch (caught) {
			setCancelError(
				caught instanceof ApiClientError ? caught.message : "Could not cancel the task.",
			);
		} finally {
			setCancelling(false);
		}
	}

	async function decide(approval: ApprovalRow, decision: "approve" | "reject") {
		setDeciding(approval.id);
		setDecisionError(null);
		try {
			await apiFetch(`/api/tasks/${task.id}/approvals/${approval.id}`, {
				method: "POST",
				body: JSON.stringify({ decision, note: decisionNote || undefined }),
			});
			setDecisionNote("");
			await refresh();
			router.refresh();
		} catch (caught) {
			setDecisionError(
				caught instanceof ApiClientError ? caught.message : "Could not save your decision.",
			);
		} finally {
			setDeciding(null);
		}
	}

	const pending = approvals.filter((approval) => approval.status === "pending");
	const usage = task.usage ?? {};
	const totalTokens =
		(usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheReadTokens ?? 0);
	const testsRun = Array.isArray(task.metadata?.testsRun)
		? (task.metadata.testsRun as string[])
		: [];
	const timeline = useMemo(
		() => events.filter((event) => event.type !== "assistant.delta"),
		[events],
	);

	return (
		<div className="space-y-5">
			<header className="space-y-4">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="min-w-0">
						<Link
							href={`/app/projects/${project.id}`}
							className="inline-flex items-center gap-1.5 text-[0.6875rem] text-mist-500 hover:text-mist-200"
						>
							<ArrowLeft className="size-3" /> {project.name}
						</Link>
						<h1 className="display mt-2 text-2xl font-semibold sm:text-3xl">{task.title}</h1>
						<div className="mt-2 flex flex-wrap items-center gap-1.5">
							<StatusBadge status={task.status} />
							<span className="chip font-mono">{task.model_id}</span>
							<span className="chip">
								iteration {task.iteration}/{task.max_iterations}
							</span>
							<span className="chip">{formatRelativeTime(task.created_at)}</span>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{active ? (
							<button
								type="button"
								onClick={cancelTask}
								disabled={cancelling || task.cancel_requested}
								className="btn btn-danger"
							>
								{cancelling ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Square className="size-3.5" />
								)}
								{task.cancel_requested ? "Cancellation requested" : "Cancel task"}
							</button>
						) : (
							<Link href={`/app/projects/${project.id}`} className="btn btn-secondary">
								Open workspace <ArrowUpRight className="size-3.5" />
							</Link>
						)}
					</div>
				</div>

				{cancelError ? <InlineAlert tone="danger">{cancelError}</InlineAlert> : null}
				{pollError ? (
					<InlineAlert tone="warning" title="Live updates interrupted">
						{pollError} The task itself is unaffected. Refresh to reconnect.
					</InlineAlert>
				) : null}

				<div className="surface p-4">
					<div className="flex items-center justify-between gap-3 text-[0.7rem] text-mist-500">
						<span className="flex items-center gap-2">
							{active ? (
								<>
									<span className="size-1.5 animate-pulse-soft rounded-full bg-signal-400" />
									Live · {humanizeStatus(task.status)}
								</>
							) : (
								<>
									<CircleDot className="size-3" /> Finished {formatRelativeTime(task.completed_at)}
								</>
							)}
						</span>
						<span>{task.progress}%</span>
					</div>
					<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
						<div
							className={cn(
								"h-full rounded-full transition-all duration-700",
								task.status === "failed"
									? "bg-rose-400"
									: task.status === "cancelled"
										? "bg-amber-400"
										: "bg-signal-400",
							)}
							style={{ width: `${Math.max(task.progress, task.status === "queued" ? 3 : 8)}%` }}
						/>
					</div>
					<div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
						<Metric label="Tokens" value={formatCompact(totalTokens)} icon={Cpu} />
						<Metric label="Cost" value={formatUsd(usage.costUsd ?? 0)} icon={Cpu} />
						<Metric label="Files changed" value={String(task.files_changed)} icon={FileCode2} />
						<Metric label="Tests run" value={String(testsRun.length)} icon={Terminal} />
					</div>
				</div>
			</header>

			{pending.length > 0 ? (
				<div className="space-y-3">
					{pending.map((approval) => (
						<div key={approval.id} className="surface border-amber-400/25 bg-amber-400/[0.035] p-4">
							<div className="flex items-start gap-3">
								<span className="grid size-8 shrink-0 place-items-center rounded-lg border border-amber-400/25 bg-amber-400/10 text-amber-300">
									<AlertTriangle className="size-4" />
								</span>
								<div className="min-w-0 flex-1">
									<p className="font-display text-sm font-semibold">
										Approval required: <span className="font-mono">{approval.tool_name}</span>
									</p>
									<p className="mt-1 text-[0.7rem] leading-relaxed text-mist-500">
										The agent is paused. Nothing from this action has been applied yet. Approving
										re-queues the task; rejecting stops it.
									</p>
									<pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-white/[0.07] bg-black/30 p-2.5 font-mono text-[0.65rem] leading-relaxed text-mist-300">
										{JSON.stringify(approval.input, null, 2)}
									</pre>
									<input
										value={decisionNote}
										onChange={(event) => setDecisionNote(event.target.value)}
										placeholder="Optional note for the agent…"
										className="input mt-3 h-8 text-[0.7rem]"
									/>
									{decisionError ? (
										<p className="mt-2 text-[0.7rem] text-rose-300">{decisionError}</p>
									) : null}
									<div className="mt-3 flex gap-2">
										<button
											type="button"
											onClick={() => void decide(approval, "approve")}
											disabled={deciding === approval.id}
											className="btn btn-primary h-8 px-3 text-[0.7rem]"
										>
											{deciding === approval.id ? (
												<Loader2 className="size-3.5 animate-spin" />
											) : (
												<CheckCircle2 className="size-3.5" />
											)}
											Approve and resume
										</button>
										<button
											type="button"
											onClick={() => void decide(approval, "reject")}
											disabled={deciding === approval.id}
											className="btn btn-danger h-8 px-3 text-[0.7rem]"
										>
											<XCircle className="size-3.5" /> Reject and stop
										</button>
									</div>
								</div>
							</div>
						</div>
					))}
				</div>
			) : null}

			{task.status === "succeeded" ? (
				<div className="surface border-signal-500/20 bg-signal-500/[0.025] p-4">
					<div className="flex items-start gap-3">
						<CheckCircle2 className="mt-0.5 size-4 shrink-0 text-signal-300" />
						<div>
							<p className="font-display text-sm font-semibold text-signal-200">Task completed</p>
							<p className="mt-1 whitespace-pre-wrap text-[0.8rem] leading-relaxed text-mist-300">
								{task.summary || "The agent finished without a written summary."}
							</p>
							{testsRun.length > 0 ? (
								<div className="mt-3 flex flex-wrap gap-1.5">
									{testsRun.map((test) => (
										<span key={test} className="chip font-mono">
											{test}
										</span>
									))}
								</div>
							) : null}
							{(task.remaining_issues as unknown[]).length > 0 ? (
								<div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[0.7rem] text-amber-200">
									<p className="font-medium">Remaining issues reported by the agent</p>
									<ul className="mt-1 list-inside list-disc space-y-0.5">
										{(task.remaining_issues as string[]).map((issue) => (
											<li key={issue}>{issue}</li>
										))}
									</ul>
								</div>
							) : null}
						</div>
					</div>
				</div>
			) : null}

			{task.status === "failed" ? (
				<div className="surface border-rose-400/20 bg-rose-400/[0.03] p-4">
					<div className="flex items-start gap-3">
						<XCircle className="mt-0.5 size-4 shrink-0 text-rose-300" />
						<div>
							<p className="font-display text-sm font-semibold text-rose-200">Task failed</p>
							<p className="mt-1 whitespace-pre-wrap font-mono text-[0.72rem] leading-relaxed text-rose-100/80">
								{task.error || "No error detail was recorded."}
							</p>
							<p className="mt-2 text-[0.7rem] text-mist-500">
								Partial file changes remain in the sandbox and are listed under Changes.
							</p>
						</div>
					</div>
				</div>
			) : null}

			{task.status === "cancelled" ? (
				<InlineAlert tone="warning" title="Task cancelled">
					The worker stopped at the last safe point. Any completed edits remain in the sandbox.
				</InlineAlert>
			) : null}

			<div className="surface overflow-hidden">
				<div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2">
					<div className="flex items-center gap-1">
						<Tab active={tab === "activity"} onClick={() => setTab("activity")} icon={Hammer}>
							Activity
						</Tab>
						<Tab
							active={tab === "conversation"}
							onClick={() => setTab("conversation")}
							icon={MessageSquare}
						>
							Conversation
						</Tab>
						<Tab
							active={tab === "changes"}
							onClick={() => setTab("changes")}
							icon={GitCompareArrows}
						>
							Changes
							{changes.length > 0 ? (
								<span className="rounded-full bg-white/10 px-1.5 text-[0.6rem]">
									{changes.length}
								</span>
							) : null}
						</Tab>
					</div>
					<button
						type="button"
						onClick={() => void refresh()}
						className="btn btn-ghost h-7 px-2 text-[0.65rem]"
					>
						<RefreshCw className="size-3" /> Refresh
					</button>
				</div>

				{tab === "activity" ? (
					<div className="max-h-[620px] overflow-auto p-4">
						{timeline.length === 0 ? (
							<EmptyState
								icon={Play}
								title="Waiting for the worker"
								description="Events will stream here as soon as the queue hands this task to a worker."
							/>
						) : (
							<ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-px before:bg-white/[0.07]">
								{timeline.map((event) => (
									<EventRow key={event.id} event={event} />
								))}
							</ol>
						)}
					</div>
				) : null}

				{tab === "conversation" ? (
					<div className="max-h-[620px] space-y-4 overflow-auto p-4">
						{messages.length === 0 ? (
							<EmptyState
								icon={Bot}
								title="No messages yet"
								description="The agent's reasoning and tool calls are persisted as the task progresses."
							/>
						) : (
							messages.map((message) => <MessageBubble key={message.id} message={message} />)
						)}
					</div>
				) : null}

				{tab === "changes" ? (
					<div className="max-h-[620px] overflow-auto p-4">
						{loadingChanges ? (
							<p className="flex items-center gap-2 text-[0.7rem] text-mist-500">
								<Loader2 className="size-3 animate-spin" /> Loading diffs…
							</p>
						) : changes.length === 0 ? (
							<EmptyState
								icon={GitCompareArrows}
								title="No file changes recorded"
								description="Edits made by the agent are stored here with before/after content and a unified diff."
							/>
						) : (
							<div className="space-y-2.5">
								{changes.map((change) => (
									<div
										key={change.id}
										className="overflow-hidden rounded-xl border border-white/[0.07] bg-black/20"
									>
										<div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-2">
											<Badge
												tone={
													change.change_type === "delete"
														? "danger"
														: change.change_type === "create"
															? "success"
															: change.change_type === "revert"
																? "warning"
																: "info"
												}
											>
												{change.change_type}
											</Badge>
											<span className="truncate font-mono text-[0.7rem] text-mist-300">
												{change.path}
											</span>
											<span className="ml-auto text-[0.6rem] text-mist-600">
												{formatRelativeTime(change.created_at)}
											</span>
										</div>
										<pre className="max-h-72 overflow-auto p-3 font-mono text-[0.65rem] leading-relaxed">
											{(change.diff ?? "No textual diff available.")
												.split("\n")
												.slice(0, 220)
												.map((line, index) => (
													<div
														key={`${change.id}-${index}`}
														className={
															line.startsWith("+")
																? "text-mint-400/90"
																: line.startsWith("-")
																	? "text-rose-300/80"
																	: line.startsWith("@@")
																		? "text-iris-300"
																		: "text-mist-500"
														}
													>
														{line || " "}
													</div>
												))}
										</pre>
									</div>
								))}
							</div>
						)}
					</div>
				) : null}
			</div>

			<p className="text-center font-mono text-[0.6rem] text-mist-700">
				task {task.id} · started {formatDateTime(task.started_at)} · finished{" "}
				{formatDateTime(task.completed_at)}
			</p>
		</div>
	);
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Cpu }) {
	return (
		<div>
			<p className="flex items-center gap-1.5 text-[0.6rem] uppercase tracking-[0.1em] text-mist-600">
				<Icon className="size-3" /> {label}
			</p>
			<p className="mt-1 font-display text-base font-semibold text-mist-100">{value}</p>
		</div>
	);
}

function Tab({
	active,
	onClick,
	icon: Icon,
	children,
}: {
	active: boolean;
	onClick: () => void;
	icon: typeof Hammer;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.72rem] transition",
				active
					? "bg-white/[0.07] text-mist-50"
					: "text-mist-500 hover:bg-white/[0.04] hover:text-mist-200",
			)}
		>
			<Icon className="size-3.5" strokeWidth={1.7} />
			{children}
		</button>
	);
}

function EventRow({ event }: { event: TaskEventRow }) {
	const isTool = event.type.startsWith("tool.");
	const isError = event.level === "error";
	const isWarn = event.level === "warn";
	return (
		<li className="relative flex gap-3 pl-0">
			<span
				className={cn(
					"z-10 mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border bg-ink-850",
					isError
						? "border-rose-400/30 text-rose-300"
						: isWarn
							? "border-amber-400/30 text-amber-300"
							: isTool
								? "border-iris-400/25 text-iris-300"
								: "border-white/10 text-mist-500",
				)}
			>
				{isTool ? (
					<Wrench className="size-3" strokeWidth={1.8} />
				) : isError ? (
					<XCircle className="size-3" />
				) : isWarn ? (
					<AlertTriangle className="size-3" />
				) : (
					<CircleDot className="size-3" />
				)}
			</span>
			<div className="min-w-0 flex-1 pb-1">
				<div className="flex flex-wrap items-baseline gap-2">
					<span className="font-mono text-[0.6rem] uppercase tracking-[0.08em] text-mist-600">
						{event.type}
					</span>
					<span className="text-[0.6rem] text-mist-700">
						{formatRelativeTime(event.created_at)}
					</span>
					{event.tool_name ? (
						<span className="chip py-0 font-mono text-[0.6rem]">{event.tool_name}</span>
					) : null}
				</div>
				{event.message ? (
					<p
						className={cn(
							"mt-1 whitespace-pre-wrap text-[0.75rem] leading-relaxed",
							isError ? "text-rose-200" : isWarn ? "text-amber-100/90" : "text-mist-300",
						)}
					>
						{event.message}
					</p>
				) : null}
				{event.payload && Object.keys(event.payload).length > 0 ? (
					<details className="group mt-1">
						<summary className="flex cursor-pointer list-none items-center gap-1 text-[0.6rem] text-mist-600 hover:text-mist-400">
							<ChevronDown className="size-3 transition group-open:rotate-180" /> payload
						</summary>
						<pre className="mt-1 max-h-56 overflow-auto rounded-md border border-white/[0.06] bg-black/30 p-2 font-mono text-[0.6rem] leading-relaxed text-mist-400">
							{JSON.stringify(event.payload, null, 2).slice(0, 4000)}
						</pre>
					</details>
				) : null}
			</div>
		</li>
	);
}

function MessageBubble({ message }: { message: MessageRow }) {
	const parts = Array.isArray(message.content)
		? (message.content as Array<Record<string, unknown>>)
		: [];
	const text = parts
		.filter((part) => part.type === "text")
		.map((part) => String(part.text ?? ""))
		.join("\n");
	const toolCalls = parts.filter((part) => part.type === "tool-call");
	const toolResults = parts.filter((part) => part.type === "tool-result");
	const isUser = message.role === "user";

	return (
		<div className={cn("flex gap-3", isUser ? "flex-row" : "flex-row")}>
			<span
				className={cn(
					"grid size-7 shrink-0 place-items-center rounded-lg border",
					isUser
						? "border-white/10 bg-white/5 text-mist-300"
						: message.role === "tool"
							? "border-iris-400/20 bg-iris-400/10 text-iris-300"
							: "border-signal-500/20 bg-signal-500/10 text-signal-300",
				)}
			>
				{isUser ? (
					<User className="size-3.5" />
				) : message.role === "tool" ? (
					<Wrench className="size-3.5" />
				) : (
					<Bot className="size-3.5" />
				)}
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="text-[0.7rem] font-medium capitalize text-mist-300">{message.role}</span>
					<span className="text-[0.6rem] text-mist-700">
						{formatRelativeTime(message.created_at)}
					</span>
					{message.model_id ? (
						<span className="truncate font-mono text-[0.55rem] text-mist-700">
							{message.model_id}
						</span>
					) : null}
				</div>
				{text ? <p className="prose-chat mt-1 whitespace-pre-wrap">{text}</p> : null}
				{toolCalls.map((part, index) => (
					<div
						key={`call-${index}`}
						className="mt-2 rounded-lg border border-iris-400/15 bg-iris-400/[0.04] px-3 py-2"
					>
						<p className="font-mono text-[0.65rem] text-iris-300">
							→ {String(part.toolName ?? "tool")}
						</p>
						<pre className="mt-1 max-h-40 overflow-auto font-mono text-[0.6rem] leading-relaxed text-mist-400">
							{JSON.stringify(part.input ?? {}, null, 2).slice(0, 2000)}
						</pre>
					</div>
				))}
				{toolResults.map((part, index) => (
					<div
						key={`result-${index}`}
						className={cn(
							"mt-2 rounded-lg border px-3 py-2",
							part.isError
								? "border-rose-400/20 bg-rose-400/[0.04]"
								: "border-white/[0.07] bg-white/[0.02]",
						)}
					>
						<p className="font-mono text-[0.65rem] text-mist-400">
							← {String(part.toolName ?? "tool")} {part.isError ? "· error" : "· result"}
						</p>
						<pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[0.6rem] leading-relaxed text-mist-500">
							{typeof part.output === "string"
								? part.output.slice(0, 4000)
								: JSON.stringify(part.output ?? null, null, 2).slice(0, 4000)}
						</pre>
					</div>
				))}
			</div>
		</div>
	);
}

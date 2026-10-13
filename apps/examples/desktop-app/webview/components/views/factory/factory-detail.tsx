"use client";

import type {
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	FactoryCheck,
	FactoryTaskConfig,
} from "@cline/shared";
import { AgentAskQuestion } from "@cline/ui";
import { ArrowUpRight, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { serializeAttachments } from "@/hooks/chat-session/attachments";
import type { AskQuestionRequestItem } from "@/hooks/chat-session/types";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import type { SessionFileDiff } from "@/lib/session-diff";
import { cn } from "@/lib/utils";
import { LOCAL_WORKSPACE_ENVIRONMENT_ID } from "@/lib/workspace-paths";
import { DiffView } from "../chat/diff-view";
import { PullRequestBar } from "../chat/pull-request-bar";

export const DEFAULT_FACTORY: FactoryTaskConfig = {
	execution: "local",
	approval: "required",
	maxRepairRounds: 2,
	checks: [],
	publishPullRequest: false,
};
const labelClass = "block space-y-2 text-sm font-medium";
const selectClass =
	"h-9 rounded-md border border-input bg-background px-3 text-sm";

export function FeatureDetail({
	task,
	onRefresh,
	onOpenSession,
	questions,
	onAnswer,
}: {
	task: AgendaTaskRecord;
	onRefresh: () => Promise<void>;
	questions: AskQuestionRequestItem[];
	onAnswer: (requestId: string, answer: string) => Promise<void>;
	onOpenSession: (
		sessionId: string,
		initialPromptDraft?: string,
	) => Promise<void>;
}) {
	const [instructions, setInstructions] = useState(task.instructions);
	const [draftRevision, setDraftRevision] = useState(task.revision);
	const [config, setConfig] = useState(task.factory ?? DEFAULT_FACTORY);
	const [runs, setRuns] = useState<AgendaTaskRunRecord[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pendingAnswers, setPendingAnswers] = useState<
		Record<string, string | undefined>
	>({});
	const [questionErrors, setQuestionErrors] = useState<
		Record<string, string | undefined>
	>({});
	const [diff, setDiff] = useState<{
		runId: string | undefined;
		commit: string | undefined;
		files: SessionFileDiff[];
	} | null>(null);
	const [startedDesignSession, setDesignSession] = useState<string>();
	const designSession = startedDesignSession ?? task.originSessionId;
	const [designStarted, setDesignStarted] = useState(false);
	const [savedDraft, setSavedDraft] = useState({
		revision: task.revision,
		instructions: task.instructions,
		config: task.factory ?? DEFAULT_FACTORY,
	});
	const dirty =
		instructions !== savedDraft.instructions ||
		JSON.stringify(config) !== JSON.stringify(savedDraft.config);
	useEffect(() => {
		if (!dirty && task.revision > savedDraft.revision) {
			setInstructions(task.instructions);
			setConfig(task.factory ?? DEFAULT_FACTORY);
			setDraftRevision(task.revision);
			setSavedDraft({
				revision: task.revision,
				instructions: task.instructions,
				config: task.factory ?? DEFAULT_FACTORY,
			});
		}
	}, [task, dirty, savedDraft.revision]);
	const editable =
		task.status === "pending_approval" ||
		task.status === "approved" ||
		task.status === "failed";
	useEffect(() => {
		let active = true;
		void desktopClient
			.getFactoryTask(task.taskId)
			.then((result) => {
				if (active) setRuns(result.runs ?? []);
			})
			.catch((cause: unknown) => {
				if (active)
					setError(
						cause instanceof Error
							? cause.message
							: "Unable to load execution evidence.",
					);
			});
		return () => {
			active = false;
		};
	}, [task]);
	const run =
		runs.find((item) => item.runId === task.currentRunId) ??
		runs.find((item) => item.runId === task.lastRunId) ??
		runs[0];
	const state = run?.factory;
	const fileDiffs =
		diff?.runId === run?.runId && diff?.commit === state?.candidateCommit
			? diff?.files
			: null;
	const currentEvidence = run?.taskRevision === task.revision;
	const canFollowUp =
		task.status === "completed" &&
		task.factory?.watchPullRequest &&
		state?.pullRequestWatch &&
		state.pullRequestUrl &&
		currentEvidence;
	const followUpStopped =
		state?.pullRequestWatch?.paused ||
		state?.phase === "blocked" ||
		state?.phase === "ready";
	async function perform(action: () => Promise<void>) {
		setBusy(true);
		setError(null);
		try {
			await action();
			await onRefresh();
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Unable to update feature.",
			);
		} finally {
			setBusy(false);
		}
	}
	async function save() {
		if (!dirty) return task;
		const saved = await desktopClient.updateAgendaTask({
			taskId: task.taskId,
			expectedRevision: draftRevision,
			instructions,
			factory: config,
			allWorkspaces: true,
		});
		setDraftRevision(saved.revision);
		setSavedDraft({ revision: saved.revision, instructions, config });
		return saved;
	}
	return (
		<>
			<DialogHeader>
				<DialogTitle>{task.title}</DialogTitle>
				<DialogDescription>
					{task.workspaceRoot} · Revision {task.revision}
					{task.modelSelection
						? ` · ${task.modelSelection.providerId}/${task.modelSelection.modelId ?? "default"}`
						: ""}
				</DialogDescription>
			</DialogHeader>
			{task.factory?.sourceIssue ? (
				<Button
					variant="link"
					className="h-auto justify-start p-0"
					onClick={() =>
						void openExternalUrl(task.factory?.sourceIssue?.url ?? "")
					}
				>
					Source issue <ArrowUpRight className="ml-1 size-3" />
				</Button>
			) : null}
			<div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
				<span
					className={cn(
						"rounded px-2 py-1 text-xs",
						task.status === "failed"
							? "bg-destructive/10 text-destructive"
							: "bg-background",
					)}
				>
					{currentEvidence &&
					(task.status === "in_progress" ||
						task.status === "completed" ||
						task.status === "failed")
						? (state?.phase ?? task.status.replaceAll("_", " "))
						: task.status.replaceAll("_", " ")}
				</span>
				{state ? (
					<span className="text-xs text-muted-foreground">
						{state.phase === "watching"
							? "Watching CI and review comments · "
							: ""}
						Repair round {state.repairRound} of {task.factory?.maxRepairRounds}
					</span>
				) : (
					<span className="text-xs text-muted-foreground">
						Design → implement → verify → review
					</span>
				)}
			</div>
			{error || task.error || state?.error ? (
				<p
					role="alert"
					className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
				>
					{error || state?.error || task.error}
				</p>
			) : null}
			{questions.length ? (
				<section className="space-y-3 rounded-lg border border-amber-500/30 p-4">
					<h3 className="text-sm font-semibold">Needs your answer</h3>
					<AgentAskQuestion
						items={questions.map((question) => ({
							id: question.requestId,
							question: question.question,
							options: question.options,
						}))}
						pendingAnswers={pendingAnswers}
						errors={questionErrors}
						onAnswer={(id, answer) => {
							setPendingAnswers((current) => ({ ...current, [id]: answer }));
							setQuestionErrors((current) => ({ ...current, [id]: undefined }));
							void onAnswer(id, answer)
								.catch((cause: unknown) => {
									setQuestionErrors((current) => ({
										...current,
										[id]:
											cause instanceof Error
												? cause.message
												: "Unable to send answer.",
									}));
								})
								.finally(() =>
									setPendingAnswers((current) => ({
										...current,
										[id]: undefined,
									})),
								);
						}}
					/>
				</section>
			) : null}
			<section className="space-y-3">
				<div className="flex items-center justify-between gap-3">
					<h3 className="text-sm font-semibold">Design brief</h3>
					<Button
						size="sm"
						variant="outline"
						disabled={busy || !editable}
						onClick={() =>
							void perform(async () => {
								const saved = await save();
								const result = await desktopClient.designFactoryTask(
									saved.taskId,
								);
								setDesignSession(result.sessionId);
								setDesignStarted(true);
							})
						}
					>
						{task.originSessionId ? "Refine design" : "Interview with agent"}
					</Button>
				</div>
				<p className="text-xs leading-5 text-muted-foreground">
					The agent reads your request, docs and repository, then asks about
					unresolved requirements here. The agreed brief and checks are saved
					for your approval. Approval authorizes agent tools and these check
					commands on your machine, using an isolated Git worktree. The worktree
					is not a security sandbox.
				</p>
				{designStarted ? (
					<output className="block text-xs text-muted-foreground">
						Design interview started. Questions will appear here as the agent
						reads the context.
					</output>
				) : null}
				{designSession ? (
					<Button
						size="sm"
						variant="ghost"
						onClick={() => void onOpenSession(designSession)}
					>
						Open design conversation <ArrowUpRight className="ml-1 size-3" />
					</Button>
				) : null}
				{dirty && task.revision !== draftRevision ? (
					<p role="alert" className="text-xs text-amber-600">
						The agent saved a newer brief. Reload it before making further
						changes.
						<Button
							size="sm"
							variant="link"
							onClick={() => {
								setInstructions(task.instructions);
								setConfig(task.factory ?? DEFAULT_FACTORY);
								setDraftRevision(task.revision);
								setSavedDraft({
									revision: task.revision,
									instructions: task.instructions,
									config: task.factory ?? DEFAULT_FACTORY,
								});
							}}
						>
							Load saved brief
						</Button>
					</p>
				) : null}
				<Textarea
					aria-label="Design brief"
					disabled={!editable || busy}
					value={instructions}
					onChange={(event) => setInstructions(event.target.value)}
					rows={7}
				/>
				<label className={labelClass} htmlFor="feature-documents">
					Reference docs
					<Input
						id="feature-documents"
						type="file"
						accept=".md,.markdown,.txt,text/plain,text/markdown"
						multiple
						disabled={!editable || busy}
						onChange={(event) => {
							const files = Array.from(event.target.files ?? []);
							event.target.value = "";
							void perform(async () => {
								if (
									files.some(
										(file) =>
											!/\.(md|markdown|txt)$/i.test(file.name) ||
											file.size > 100_000,
									)
								)
									throw new Error(
										"Use Markdown or text files up to 100 KB each.",
									);
								if ((config.documents?.length ?? 0) + files.length > 10)
									throw new Error("Attach up to 10 reference docs.");
								const attachments = await serializeAttachments(files);
								setConfig((current) => ({
									...current,
									documents: [
										...(current.documents ?? []),
										...attachments.userFiles,
									],
								}));
							});
						}}
					/>
				</label>
				{config.documents?.map((doc, index) => (
					<div
						key={`${doc.name}-${index}`}
						className="flex items-center justify-between rounded border px-3 py-1 text-xs"
					>
						<span>{doc.name}</span>
						<Button
							size="icon"
							variant="ghost"
							aria-label={`Remove ${doc.name}`}
							disabled={!editable || busy}
							onClick={() =>
								setConfig({
									...config,
									documents: config.documents?.filter((_, i) => i !== index),
								})
							}
						>
							<X className="size-3" />
						</Button>
					</div>
				))}
			</section>
			<section className="space-y-3">
				<div className="flex items-center justify-between">
					<h3 className="text-sm font-semibold">
						Required checks and evidence
					</h3>
					<Button
						variant="ghost"
						size="sm"
						disabled={!editable || busy}
						onClick={() =>
							setConfig({
								...config,
								checks: [
									...config.checks,
									{ name: "", command: "", kind: "test", artifacts: [] },
								],
							})
						}
					>
						<Plus className="mr-1 size-3" />
						Add check
					</Button>
				</div>
				<p className="text-xs leading-5 text-muted-foreground">
					Commands run in the feature worktree. For UI changes, require
					screenshots or recordings; for backend changes, include route/API or
					end-to-end tests. Artifact paths are relative to the worktree.
				</p>
				{config.checks.map((check, index) => (
					<CheckEditor
						key={index}
						check={check}
						disabled={!editable || busy}
						onChange={(next) =>
							setConfig({
								...config,
								checks: config.checks.map((item, i) =>
									i === index ? next : item,
								),
							})
						}
						onRemove={() =>
							setConfig({
								...config,
								checks: config.checks.filter((_, i) => i !== index),
							})
						}
					/>
				))}
				{config.checks.length === 0 ? (
					<p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
						Add at least one concrete verification command before approval.
					</p>
				) : null}
			</section>
			<div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-3">
				<label className={labelClass}>
					Design approval
					<select
						className={selectClass}
						disabled={!editable || busy}
						value={config.approval}
						onChange={(event) =>
							setConfig({
								...config,
								approval:
									event.target.value === "automatic" ? "automatic" : "required",
							})
						}
					>
						<option value="required">Upfront approval</option>
						<option value="automatic">Automatic</option>
					</select>
				</label>
				<label className={labelClass} htmlFor="feature-repairs">
					Repair rounds
					<Input
						id="feature-repairs"
						type="number"
						min={0}
						max={10}
						disabled={!editable || busy}
						value={config.maxRepairRounds}
						onChange={(event) =>
							setConfig({
								...config,
								maxRepairRounds: Math.max(
									0,
									Math.min(10, Number(event.target.value)),
								),
							})
						}
					/>
				</label>
				<div className={labelClass}>
					Execution<p className="pt-2 text-sm font-normal">Local</p>
					<p className="text-xs font-normal text-muted-foreground">
						Cloud runner not connected yet.
					</p>
				</div>
			</div>
			<label className="flex items-start gap-2 text-sm">
				<input
					type="checkbox"
					className="mt-1"
					disabled={!editable || busy}
					checked={config.publishPullRequest}
					onChange={(event) =>
						setConfig({ ...config, publishPullRequest: event.target.checked })
					}
				/>
				<span>
					Publish a draft PR after checks and review pass
					<span className="mt-1 block text-xs text-muted-foreground">
						Off: retain tested changes on the local feature branch for
						inspection.
					</span>
				</span>
			</label>
			{config.publishPullRequest ? (
				<label className="flex items-start gap-2 text-sm">
					<input
						type="checkbox"
						className="mt-1"
						disabled={!editable || busy}
						checked={config.watchPullRequest ?? false}
						onChange={(event) =>
							setConfig({ ...config, watchPullRequest: event.target.checked })
						}
					/>
					<span>
						Babysit the PR after publishing
						<span className="mt-1 block text-xs text-muted-foreground">
							Watch CI and review comments, repair within the round limit, and
							reply after verification. You decide when to merge.
						</span>
					</span>
				</label>
			) : null}
			{state ? (
				<section className="space-y-3 border-t pt-4">
					<h3 className="text-sm font-semibold">
						Review packet · revision {run?.taskRevision}
						{currentEvidence ? "" : " (previous brief)"}
					</h3>
					<p className="break-all font-mono text-xs text-muted-foreground">
						{state.workspace.branch}
						{state.candidateCommit
							? ` · ${state.candidateCommit.slice(0, 12)}`
							: ""}
					</p>
					<p className="break-all text-xs text-muted-foreground">
						{state.workspace.path}
					</p>
					<Button
						variant="outline"
						size="sm"
						disabled={busy || !state.candidateCommit}
						onClick={() =>
							void perform(async () => {
								const diff = await desktopClient.invoke<SessionFileDiff[]>(
									"factory_get_diff",
									{ taskId: task.taskId, runId: run?.runId },
								);
								setDiff({
									runId: run?.runId,
									commit: state.candidateCommit,
									files: diff,
								});
							})
						}
					>
						Review changes
					</Button>
					{fileDiffs ? (
						<div className="flex h-[32rem] flex-col overflow-hidden rounded-lg border">
							<DiffView
								title={`Feature changes · ${state.candidateCommit?.slice(0, 12) ?? "candidate"}`}
								environmentId={LOCAL_WORKSPACE_ENVIRONMENT_ID}
								cwd={state.workspace.path}
								fileDiffs={fileDiffs}
								onClose={() => setDiff(null)}
							/>
						</div>
					) : null}
					{state.pullRequestUrl ? (
						<PullRequestBar
							cwd={state.workspace.path}
							branch={state.workspace.branch}
						/>
					) : null}
					{state.checks.map((check, index) => (
						<div
							className="rounded-lg border p-3"
							key={`${check.name}-${index}`}
						>
							<div className="flex justify-between text-sm">
								<strong>{check.name}</strong>
								<span
									className={
										check.status === "passed"
											? "text-emerald-600"
											: "text-destructive"
									}
								>
									{check.status}
								</span>
							</div>
							<code className="mt-2 block break-all text-xs text-muted-foreground">
								{check.command}
							</code>
							<details className="mt-2 text-xs">
								<summary className="cursor-pointer">
									Output
									{check.exitCode !== null ? ` · exit ${check.exitCode}` : ""}
								</summary>
								<pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-2">
									{check.output || "No output recorded."}
								</pre>
							</details>
							{check.artifacts.map((artifact) => (
								<EvidencePreview
									key={artifact.path}
									taskId={task.taskId}
									runId={run?.runId ?? ""}
									artifact={artifact}
								/>
							))}
						</div>
					))}
					{state.review ? (
						<div className="rounded-lg border p-3 text-sm">
							<h4 className="font-medium">
								Independent review · {state.review.verdict.replaceAll("_", " ")}
							</h4>
							<p className="mt-2 whitespace-pre-wrap text-muted-foreground">
								{state.review.summary}
							</p>
							{state.review.findings.length ? (
								<ul className="mt-2 list-disc space-y-1 pl-5">
									{state.review.findings.map((finding) => (
										<li key={finding}>{finding}</li>
									))}
								</ul>
							) : null}
						</div>
					) : null}
					<div className="flex flex-wrap gap-2">
						{state.sessions.map((session, index) => (
							<Button
								key={session.sessionId}
								size="sm"
								variant="outline"
								onClick={() => void onOpenSession(session.sessionId)}
							>
								{session.role} transcript {index + 1}
								<ArrowUpRight className="ml-1 size-3" />
							</Button>
						))}
					</div>
					{state.pullRequestUrl ? (
						<Button
							onClick={() => void openExternalUrl(state.pullRequestUrl || "")}
						>
							Review draft PR
							<ArrowUpRight className="ml-2 size-3" />
						</Button>
					) : state.phase === "ready" &&
						currentEvidence &&
						task.status === "completed" ? (
						<p className="text-sm text-emerald-600">
							Checks and independent review passed. Changes are ready for your
							review on the feature branch.
						</p>
					) : null}
				</section>
			) : null}
			<div className="flex flex-wrap justify-end gap-2 border-t pt-4">
				{canFollowUp ? (
					<>
						<p className="mr-auto self-center text-xs text-muted-foreground">
							{state?.pullRequestWatch?.paused
								? "PR follow-up paused."
								: state?.phase === "blocked"
									? "PR follow-up needs attention. Resuming keeps the existing repair budget."
									: "You decide when to merge the PR."}
						</p>
						<Button
							variant="outline"
							disabled={busy}
							onClick={() =>
								void perform(async () => {
									await desktopClient.invoke("task.factory.watch", {
										taskId: task.taskId,
										expectedRevision: task.revision,
										enabled: followUpStopped,
										allWorkspaces: true,
									});
								})
							}
						>
							{followUpStopped ? "Resume PR follow-up" : "Pause PR follow-up"}
						</Button>
					</>
				) : task.status === "in_progress" ? (
					<Button
						variant="destructive"
						disabled={busy}
						onClick={() =>
							void perform(async () => {
								await desktopClient.cancelAgendaTask({
									taskId: task.taskId,
									expectedRevision: task.revision,
									allWorkspaces: true,
								});
							})
						}
					>
						Cancel execution
					</Button>
				) : editable ? (
					<>
						<Button
							variant="outline"
							disabled={busy || !instructions.trim()}
							onClick={() =>
								void perform(async () => {
									await save();
								})
							}
						>
							Save brief
						</Button>
						<Button
							disabled={
								busy ||
								!instructions.trim() ||
								config.checks.length === 0 ||
								config.checks.some(
									(check) => !check.name.trim() || !check.command.trim(),
								)
							}
							onClick={() =>
								void perform(async () => {
									const saved = await save();
									const approved = await desktopClient.approveAgendaTask({
										taskId: saved.taskId,
										expectedRevision: saved.revision,
										allWorkspaces: true,
									});
									setDraftRevision(approved.revision);
								})
							}
						>
							Approve for queue
						</Button>
					</>
				) : (
					<p className="text-xs text-muted-foreground">
						This feature is closed. Create a new feature for further changes.
					</p>
				)}
			</div>
		</>
	);
}

function CheckEditor({
	check,
	disabled,
	onChange,
	onRemove,
}: {
	check: FactoryCheck;
	disabled: boolean;
	onChange: (check: FactoryCheck) => void;
	onRemove: () => void;
}) {
	return (
		<div className="space-y-2 rounded-lg border p-3">
			<div className="flex gap-2">
				<Input
					aria-label="Check name"
					placeholder="API integration tests"
					value={check.name}
					disabled={disabled}
					onChange={(event) => onChange({ ...check, name: event.target.value })}
				/>
				<select
					aria-label="Check type"
					className={selectClass}
					value={check.kind}
					disabled={disabled}
					onChange={(event) => {
						const kind = event.target.value;
						if (kind === "test" || kind === "api" || kind === "ui")
							onChange({ ...check, kind });
					}}
				>
					<option value="test">Tests</option>
					<option value="api">API / E2E</option>
					<option value="ui">UI</option>
				</select>
				<Button
					size="icon"
					variant="ghost"
					aria-label="Remove check"
					disabled={disabled}
					onClick={onRemove}
				>
					<X className="size-4" />
				</Button>
			</div>
			<Input
				aria-label="Check command"
				className="font-mono text-xs"
				placeholder="bun run test:api"
				value={check.command}
				disabled={disabled}
				onChange={(event) =>
					onChange({ ...check, command: event.target.value })
				}
			/>
			<Input
				aria-label="Required evidence paths"
				className="text-xs"
				placeholder="Required artifacts, separated by commas: evidence/export.png"
				value={check.artifacts.join(", ")}
				disabled={disabled}
				onChange={(event) =>
					onChange({
						...check,
						artifacts: event.target.value
							.split(",")
							.map((path) => path.trim())
							.filter(Boolean),
					})
				}
			/>
		</div>
	);
}

function EvidencePreview({
	taskId,
	runId,
	artifact,
}: {
	taskId: string;
	runId: string;
	artifact: { path: string; label: string; mimeType: string };
}) {
	const [dataUrl, setDataUrl] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	return (
		<div className="mt-3">
			<Button
				size="sm"
				variant="outline"
				disabled={loading}
				onClick={() => {
					setLoading(true);
					void desktopClient
						.invoke<{ dataUrl: string }>("factory_read_artifact", {
							taskId,
							runId,
							path: artifact.path,
						})
						.then((result) => {
							setDataUrl(result.dataUrl);
							setError(null);
						})
						.catch((cause: unknown) =>
							setError(
								cause instanceof Error
									? cause.message
									: "Unable to load evidence.",
							),
						)
						.finally(() => setLoading(false));
				}}
			>
				{loading ? "Loading…" : artifact.label}
			</Button>
			{error ? (
				<p role="alert" className="mt-1 text-xs text-destructive">
					{error}
				</p>
			) : null}
			{dataUrl && artifact.mimeType.startsWith("image/") ? (
				<img
					src={dataUrl}
					alt={artifact.label}
					className="mt-2 max-h-96 rounded border object-contain"
				/>
			) : dataUrl && artifact.mimeType.startsWith("video/") ? (
				<video src={dataUrl} controls className="mt-2 max-h-96 rounded border">
					<track kind="captions" />
				</video>
			) : null}
		</div>
	);
}

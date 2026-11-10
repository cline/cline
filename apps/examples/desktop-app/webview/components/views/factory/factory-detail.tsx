"use client";

import type {
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	FactoryTaskConfig,
} from "@cline/shared";
import { AgentAskQuestion } from "@cline/ui";
import { factoryReviewFindings } from "@cline/shared/browser";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { MemoizedMarkdown } from "@/components/ui/markdown";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AskQuestionRequestItem } from "@/hooks/chat-session/types";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import type { SessionFileDiff } from "@/lib/session-diff";
import { LOCAL_WORKSPACE_ENVIRONMENT_ID } from "@/lib/workspace-paths";
import { DiffView } from "../chat/diff-view";
import { PullRequestBar } from "../chat/pull-request-bar";

import { FactoryTaskHeader } from "./factory-task-header";
import { EvidencePreview, ReviewResult } from "./factory-detail-evidence";
import { FactoryDetailConfiguration } from "./factory-detail-configuration";

export const DEFAULT_FACTORY: FactoryTaskConfig = {
	execution: "local",
	approval: "required",
	maxRepairRounds: 2,
	checks: [],
	publishPullRequest: false,
};

const taskEvidenceEventSchema = z.object({
	task: z.object({ taskId: z.string() }),
});
export type FactoryDraft = {
	revision: number;
	instructions: string;
	config: FactoryTaskConfig;
};

export function FeatureDetail({
	drafts,
	task,
	onRefresh,
	onClose,
	onOpenSession,
	questions,
	onAnswer,
}: {
	drafts: Map<string, FactoryDraft>;
	task: AgendaTaskRecord;
	onRefresh: () => Promise<void>;
	onClose: () => void;
	questions: AskQuestionRequestItem[];
	onAnswer: (requestId: string, answer: string) => Promise<void>;
	onOpenSession: (
		sessionId: string,
		initialPromptDraft?: string,
	) => Promise<void>;
}) {
	const [restoredDraft] = useState(() => drafts.get(task.taskId));
	const [editing, setEditing] = useState(false);
	const pageStorageKey = `factory.taskSection.${task.taskId}`;
	const [page, setPage] = useState(() => {
		const saved =
			typeof window === "undefined"
				? null
				: sessionStorage.getItem(pageStorageKey);
		if (saved === "plan" || saved === "verification") return saved;
		return (task.status === "in_progress" ||
			task.status === "completed" ||
			task.status === "failed") &&
			(task.currentRunId || task.lastRunId)
			? "verification"
			: "plan";
	});
	useEffect(() => {
		sessionStorage.setItem(pageStorageKey, page);
	}, [pageStorageKey, page]);
	const [pendingNavigation, setPendingNavigation] = useState<
		(() => void) | null
	>(null);
	const [runsLoading, setRunsLoading] = useState(true);
	const [evidenceVersion, setEvidenceVersion] = useState(0);
	const [transportReady, setTransportReady] = useState(false);
	useEffect(() => {
		const invalidate = () => setEvidenceVersion((version) => version + 1);
		const onTaskEvent = (payload: unknown) => {
			const result = taskEvidenceEventSchema.safeParse(payload);
			if (result.success && result.data.task.taskId === task.taskId)
				invalidate();
		};
		const unsubscribeEvents = [
			"task.updated",
			"task.run.started",
			"task.run.completed",
			"task.run.failed",
		].map((event) => desktopClient.subscribe(event, onTaskEvent));
		let reconnecting = false;
		const unsubscribeTransport = desktopClient.subscribeTransportState(
			(state) => {
				setTransportReady(state === "connected");
				if (state === "reconnecting" || state === "unavailable")
					reconnecting = true;
				if (state === "connected" && reconnecting) {
					reconnecting = false;
					invalidate();
				}
			},
		);
		return () => {
			for (const unsubscribe of unsubscribeEvents) unsubscribe();
			unsubscribeTransport();
		};
	}, [task.taskId]);
	const evidenceKey = JSON.stringify([
		task.taskId,
		task.revision,
		task.currentRunId,
		task.lastRunId,
		task.updatedAt,
		evidenceVersion,
	]);
	const [loadedEvidenceKey, setLoadedEvidenceKey] = useState<string>();
	const [evidenceError, setEvidenceError] = useState<string | null>(null);
	const [instructions, setInstructions] = useState(
		restoredDraft?.instructions ?? task.instructions,
	);
	const [draftRevision, setDraftRevision] = useState(
		restoredDraft?.revision ?? task.revision,
	);
	const [config, setConfig] = useState(
		restoredDraft?.config ?? task.factory ?? DEFAULT_FACTORY,
	);
	const [runs, setRuns] = useState<AgendaTaskRunRecord[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [auditFinding, setAuditFinding] = useState("");
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
		if (dirty)
			drafts.set(task.taskId, {
				revision: draftRevision,
				instructions,
				config,
			});
		else drafts.delete(task.taskId);
	}, [dirty, drafts, task.taskId, draftRevision, instructions, config]);
	useEffect(() => {
		if (!dirty && task.revision > draftRevision) {
			setInstructions(task.instructions);
			setConfig(task.factory ?? DEFAULT_FACTORY);
			setDraftRevision(task.revision);
			setSavedDraft({
				revision: task.revision,
				instructions: task.instructions,
				config: task.factory ?? DEFAULT_FACTORY,
			});
		}
	}, [task, dirty, draftRevision]);
	const designActive =
		!task.error &&
		task.factoryDesignProgress?.revision === task.revision &&
		task.factoryDesignProgress.phase !== "complete";
	const editable =
		!task.archivedAt &&
		(task.status === "pending_approval" ||
			task.status === "approved" ||
			task.status === "failed");
	useEffect(() => {
		let active = true;
		setRunsLoading(true);
		setEvidenceError(null);
		void desktopClient
			.getFactoryTask(task.taskId)
			.then((result) => {
				if (active) {
					setRuns(result.runs ?? []);
					setLoadedEvidenceKey(evidenceKey);
					setRunsLoading(false);
				}
			})
			.catch((cause: unknown) => {
				if (active) {
					setRunsLoading(false);
					setEvidenceError(
						cause instanceof Error
							? cause.message
							: "Unable to load execution evidence.",
					);
				}
			});
		return () => {
			active = false;
		};
	}, [evidenceKey, task.taskId]);
	const run =
		runs.find((item) => item.runId === task.currentRunId) ??
		runs.find((item) => item.runId === task.lastRunId) ??
		runs[0];
	const state = run?.factory;
	const fileDiffs =
		diff?.runId === run?.runId && diff?.commit === state?.candidate?.commit
			? diff?.files
			: null;
	const matchesTask =
		run?.taskRevision === task.revision &&
		run?.runId === (task.currentRunId ?? task.lastRunId);
	const currentEvidence =
		transportReady &&
		matchesTask &&
		loadedEvidenceKey === evidenceKey &&
		!runsLoading &&
		!evidenceError;
	const canFollowUp =
		!task.archivedAt &&
		task.status === "completed" &&
		task.factory?.watchPullRequest &&
		state?.pullRequestWatch &&
		state.pullRequestUrl &&
		matchesTask;
	const followUpStopped =
		state?.pullRequestWatch?.paused ||
		state?.phase === "blocked" ||
		state?.phase === "ready";
	const sessions = new Map<string, string>();
	if (designSession) sessions.set(designSession, "Designer");
	const designProgress = task.factoryDesignProgress;
	if (designProgress && designProgress.phase !== "designing") {
		for (const reviewer of designProgress.reviewerSessions)
			sessions.set(
				reviewer.sessionId,
				`Plan reviewer ${reviewer.reviewerIndex + 1}${designProgress.revision === task.revision ? "" : " (previous plan)"}`,
			);
	}
	for (const reviewer of task.factoryDesignReview?.reviews ?? [])
		sessions.set(
			reviewer.sessionId,
			`Plan reviewer ${reviewer.reviewerIndex + 1}${task.factoryDesignReview?.revision === task.revision ? "" : " (previous plan)"}`,
		);
	const roleCounts = { builder: 0, reviewer: 0, verifier: 0 };
	for (const session of state?.sessions ?? []) {
		roleCounts[session.role] += 1;
		sessions.set(
			session.sessionId,
			`${session.role === "builder" ? "Implementer" : session.role === "reviewer" ? "Reviewer" : "Verifier"} ${roleCounts[session.role]}${matchesTask ? "" : " (previous execution)"}`,
		);
	}
	const planReviewers = config.agents?.planReviewers ?? [];
	const planReviewBlocked =
		planReviewers.length > 0 &&
		(dirty ||
			task.factoryDesignReview?.revision !== task.revision ||
			planReviewers.some((_, index) => {
				const result = task.factoryDesignReview?.reviews.find(
					(review) => review.reviewerIndex === index,
				);
				return !result || factoryReviewFindings(result.review).length > 0;
			}));
	const approvalReason = designActive
		? "The plan is still being prepared. Wait for scoping and review to finish."
		: dirty && planReviewers.length > 0
			? "Draft changes need a new plan review. Refine the design to save and review them."
			: planReviewBlocked
				? "Complete plan review for this revision before approval. Refine the design to resolve missing reviews, findings or unverified work."
				: !instructions.trim() ||
						config.checks.length === 0 ||
						config.checks.some(
							(check) => !check.name.trim() || !check.command.trim(),
						)
					? "Add a brief and at least one named verification command before approval."
					: null;
	function navigate(action: () => void) {
		if (dirty) setPendingNavigation(() => action);
		else action();
	}
	async function openSession(sessionId: string) {
		navigate(() => {
			void onOpenSession(sessionId);
		});
	}

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
		<Tabs value={page} onValueChange={setPage} className="space-y-4">
			<FactoryTaskHeader
				task={task}
				busy={busy}
				designActive={designActive}
				state={currentEvidence ? state : undefined}
				approvalReason={approvalReason}
				onBack={() => navigate(onClose)}
				onArchive={() =>
					void perform(async () => {
						await desktopClient.invoke(
							task.archivedAt ? "task.restore" : "task.archive",
							{
								taskId: task.taskId,
								expectedRevision: task.revision,
								allWorkspaces: true,
							},
						);
						onClose();
					})
				}
				onDelete={() =>
					void perform(async () => {
						await desktopClient.invoke("task.delete", {
							taskId: task.taskId,
							expectedRevision: task.revision,
							allWorkspaces: true,
						});
						drafts.delete(task.taskId);
						onClose();
					})
				}
			/>
			<AlertDialog
				open={pendingNavigation !== null}
				onOpenChange={(open) => {
					if (!open) setPendingNavigation(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Leave unsaved brief changes?</AlertDialogTitle>
						<AlertDialogDescription>
							Your draft has not been saved. Stay here to save it, or discard
							the draft and continue.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep editing</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								drafts.delete(task.taskId);
								setInstructions(savedDraft.instructions);
								setConfig(savedDraft.config);
								setDraftRevision(savedDraft.revision);
								pendingNavigation?.();
								setPendingNavigation(null);
							}}
						>
							Discard and continue
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			{error ||
			evidenceError ||
			task.error ||
			(currentEvidence && state?.error) ? (
				<p
					role="alert"
					className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
				>
					{error ||
						evidenceError ||
						(currentEvidence ? state?.error : undefined) ||
						task.error}
				</p>
			) : null}
			{questions.length && !task.archivedAt ? (
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

			{sessions.size ? (
				<details className="rounded-lg border p-3">
					<summary className="cursor-pointer text-sm">
						Sessions · {sessions.size}
					</summary>

					<div className="flex flex-wrap gap-2">
						{[...sessions].map(([sessionId, label]) => (
							<Button
								key={sessionId}
								size="sm"
								variant="outline"
								onClick={() => void openSession(sessionId)}
							>
								{label}
								<ArrowUpRight className="ml-1 size-3" />
							</Button>
						))}
					</div>
				</details>
			) : null}
			<TabsList aria-label="Task sections">
				<TabsTrigger value="plan">Plan</TabsTrigger>
				<TabsTrigger value="verification">Verification</TabsTrigger>
			</TabsList>
			<TabsContent value="plan" className="space-y-4">
				<section className="space-y-3">
					<div className="flex items-center justify-between gap-3">
						<h3 className="text-sm font-semibold">
							Plan{" "}
							{dirty ? (
								<span className="font-normal text-amber-600">
									· Unsaved draft
								</span>
							) : null}
						</h3>
						<Button
							size="sm"
							variant="ghost"
							disabled={!editable}
							onClick={() => setEditing((value) => !value)}
						>
							{editing ? "Preview" : "Edit"}
						</Button>
						<Button
							size="sm"
							variant="outline"
							id="factory-design-action"
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
						commands on your machine, using an isolated Git worktree. The
						worktree is not a security sandbox.
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
							onClick={() => void openSession(designSession)}
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
					{editing ? (
						<Textarea
							aria-label="Design brief"
							disabled={!editable || busy}
							value={instructions}
							onChange={(event) => setInstructions(event.target.value)}
							rows={7}
						/>
					) : (
						<MemoizedMarkdown
							content={instructions || "No plan has been recorded yet."}
							classNames="text-sm"
						/>
					)}
					{config.documents?.length ? (
						<p className="text-xs text-muted-foreground">
							Reference docs:{" "}
							{config.documents.map((doc) => doc.name).join(", ")}
						</p>
					) : null}
				</section>
				{task.factoryDesignReview ? (
					<section className="space-y-3">
						<h3 className="text-sm font-semibold">
							Plan review · revision {task.factoryDesignReview.revision}
							{dirty || task.factoryDesignReview.revision !== task.revision
								? " (previous draft)"
								: ""}
						</h3>
						{task.factoryDesignReview.reviews.map((result) => (
							<ReviewResult
								key={result.reviewerIndex}
								label={`Plan reviewer ${result.reviewerIndex + 1}`}
								review={result.review}
								sessionId={result.sessionId}
								onOpenSession={openSession}
							/>
						))}
					</section>
				) : null}
				<FactoryDetailConfiguration
					config={config}
					disabled={!editable || busy}
					setConfig={setConfig}
					perform={perform}
				/>
			</TabsContent>
			<TabsContent value="verification" className="space-y-4">
				<Button
					variant="outline"
					size="sm"
					disabled={runsLoading || !transportReady}
					onClick={() => setEvidenceVersion((version) => version + 1)}
				>
					Refresh verification
				</Button>
				{runsLoading ? (
					<p className="text-sm text-muted-foreground">Loading verification…</p>
				) : !state && !evidenceError ? (
					<p className="text-sm text-muted-foreground">
						No verification has been recorded yet.
					</p>
				) : null}

				{state ? (
					<section className="space-y-3 border-t pt-4">
						<h3 className="text-sm font-semibold">
							Verification · revision {run?.taskRevision}
							{!transportReady
								? " (cached; connection unavailable)"
								: runsLoading
									? " (refreshing…)"
									: evidenceError
										? " (cached; refresh failed)"
										: currentEvidence
											? dirty
												? " (saved plan; draft edits not verified)"
												: ""
											: " (previous execution — not current evidence)"}
						</h3>
						{state.error && !currentEvidence ? (
							<p className="text-sm text-muted-foreground">
								Recorded error: {state.error}
							</p>
						) : null}
						<p className="break-all font-mono text-xs text-muted-foreground">
							{state.workspace.branch}
							{state.candidate?.commit
								? ` · ${state.candidate.commit.slice(0, 12)}`
								: ""}
						</p>
						<p className="break-all text-xs text-muted-foreground">
							{state.workspace.path}
						</p>
						<Button
							variant="outline"
							size="sm"
							disabled={busy || !state.candidate?.commit}
							onClick={() =>
								void perform(async () => {
									const diff = await desktopClient.invoke<SessionFileDiff[]>(
										"factory_get_diff",
										{
											taskId: task.taskId,
											runId: run?.runId,
											expectedCommit: state.candidate?.commit,
										},
									);
									setDiff({
										runId: run?.runId,
										commit: state.candidate?.commit,
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
									title={`Feature changes · ${state.candidate?.commit.slice(0, 12) ?? "candidate"}`}
									environmentId={LOCAL_WORKSPACE_ENVIRONMENT_ID}
									cwd={state.workspace.path}
									fileDiffs={fileDiffs}
									onClose={() => setDiff(null)}
								/>
							</div>
						) : null}
						{state.pullRequestUrl && currentEvidence && !task.archivedAt ? (
							<PullRequestBar
								cwd={state.workspace.path}
								branch={state.workspace.branch}
							/>
						) : null}
						{state.candidate?.checks.map((check, index) => (
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
										key={`${run?.runId}:${state.candidate?.commit}:${artifact.path}`}
										taskId={task.taskId}
										runId={run?.runId ?? ""}
										artifact={artifact}
									/>
								))}
							</div>
						))}
						{state.candidate?.reviews.map((result) => (
							<ReviewResult
								key={result.reviewerIndex}
								label={`Final reviewer ${result.reviewerIndex + 1}`}
								review={result.review}
								sessionId={result.sessionId}
								onOpenSession={openSession}
							/>
						))}
						{state.candidate?.verification ? (
							<>
								<ReviewResult
									label="Agent verification"
									review={state.candidate.verification.review}
									sessionId={state.candidate.verification.sessionId}
									onOpenSession={openSession}
								/>
								{state.candidate.verification.artifacts.map((artifact) => (
									<EvidencePreview
										key={`${run?.runId}:${state.candidate?.commit}:${artifact.path}`}
										taskId={task.taskId}
										runId={run?.runId ?? ""}
										artifact={artifact}
									/>
								))}
							</>
						) : null}
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
				{state && matchesTask ? (
					<fieldset
						disabled={!!task.archivedAt || !currentEvidence}
						className="min-w-0 space-y-3 rounded-lg border p-4"
						aria-label="Factory outcome"
					>
						{!currentEvidence ? (
							<p className="text-xs text-muted-foreground">
								Saved outcome. Actions are unavailable until current evidence is
								refreshed.
							</p>
						) : null}
						<div className="flex flex-wrap items-center gap-3 text-sm">
							<span>
								{!currentEvidence
									? "Saved outcome"
									: state.humanApproval
										? "Checked off"
										: state.phase === "blocked"
											? "Needs attention"
											: state.phase === "ready"
												? "Local result awaiting your stamp"
												: state.pullRequestChecks?.status === "passed"
													? "Required CI passed"
													: "Factory is handling this feature"}
							</span>
							{state.usage ? (
								<span className="text-muted-foreground">
									Recorded model cost ${state.usage.totals.totalCost.toFixed(2)}
									{state.usage.unknownSessionIds.length
										? ` · ${state.usage.unknownSessionIds.length} sessions have unknown cost`
										: ""}
								</span>
							) : null}
							<span className="text-muted-foreground">
								{state.attempts?.length ?? 0} execution attempts
							</span>
						</div>
						{task.status === "completed" &&
						!state.humanApproval &&
						!state.audit?.finding &&
						!state.pullRequestWatch?.pending &&
						questions.length === 0 &&
						(state.phase === "ready" ||
							(state.phase === "watching" &&
								state.pullRequestChecks?.status === "passed" &&
								state.pullRequestChecks.headCommit ===
									state.candidate?.commit)) &&
						state.candidate ? (
							<Button
								disabled={busy || !currentEvidence || dirty}
								onClick={() =>
									void perform(async () => {
										await desktopClient.invoke("task.factory.stamp", {
											taskId: task.taskId,
											expectedHead: state.candidate?.commit,
											allWorkspaces: true,
										});
									})
								}
							>
								Check off this result
							</Button>
						) : null}
						{task.status !== "in_progress" ? (
							<Button
								variant="outline"
								disabled={busy || Boolean(state.audit)}
								onClick={() =>
									void perform(async () => {
										await desktopClient.invoke("task.factory.audit", {
											taskId: task.taskId,
											allWorkspaces: true,
										});
									})
								}
							>
								{state.audit
									? "Selected for sample review"
									: "Sample this outcome"}
							</Button>
						) : null}
						{state.audit ? (
							<div className="space-y-2">
								<Textarea
									aria-label="Sample review finding"
									placeholder="What did the factory miss? Leave empty if the sample passed."
									value={auditFinding}
									onChange={(event) => setAuditFinding(event.target.value)}
									disabled={busy}
								/>
								<Button
									variant="outline"
									disabled={busy}
									onClick={() =>
										void perform(async () => {
											await desktopClient.invoke("task.factory.audit", {
												taskId: task.taskId,
												finding: auditFinding,
												allWorkspaces: true,
											});
										})
									}
								>
									Record sample review
								</Button>
								{state.audit.finding ? (
									<>
										<p className="text-sm">{state.audit.finding}</p>
										<Button
											variant="outline"
											disabled={busy}
											onClick={() =>
												void perform(async () => {
													const improvement =
														await desktopClient.createAgendaTask({
															type: "todo",
															title: `Improve verification: ${task.title}`,
															scope: task.scope,
															workspaceRoot: task.workspaceRoot,
															cwd: task.cwd,
															allWorkspaces: true,
															instructions: `Investigate this sampled factory failure and fix the responsible check, skill, or environment. Reuse existing owners. Prove the changed verification catches this failure and preserves representative passing behavior. Do not weaken quality gates.\n\nFinding: ${state.audit?.finding}\nOriginal acceptance brief: ${task.instructions}\nCandidate: ${state.candidate?.commit ?? "unavailable"}`,
															factory: {
																...(task.factory ?? DEFAULT_FACTORY),
																checks: [],
																implementationUnits: undefined,
																watchPullRequest: false,
																sourceIssue: undefined,
																publishPullRequest: false,
															},
															modelSelection: task.modelSelection,
															expiresAt: new Date(
																Date.now() + 90 * 86_400_000,
															).toISOString(),
															originTaskId: task.taskId,
														});
													await desktopClient.designFactoryTask(
														improvement.taskId,
													);
												})
											}
										>
											Create factory improvement
										</Button>
									</>
								) : null}
							</div>
						) : null}
					</fieldset>
				) : null}
			</TabsContent>
			{editable && approvalReason ? (
				<p id="factory-approval-reason" className="text-sm text-amber-600">
					{approvalReason}{" "}
					<Button
						variant="link"
						size="sm"
						onClick={() => {
							setPage("plan");
							requestAnimationFrame(() =>
								document.getElementById("factory-design-action")?.focus(),
							);
						}}
					>
						Open plan and design review
					</Button>
				</p>
			) : null}
			<div className="flex flex-wrap justify-end gap-2 border-t pt-4">
				{!task.archivedAt &&
				(task.status === "in_progress" || (editable && designActive)) ? (
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
						{task.status === "in_progress"
							? "Cancel execution"
							: "Cancel scoping"}
					</Button>
				) : null}
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
							disabled={busy || !currentEvidence}
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
							aria-describedby={
								approvalReason ? "factory-approval-reason" : undefined
							}
							disabled={busy || Boolean(approvalReason)}
							onClick={() =>
								void perform(async () => {
									const saved = await save();
									const approved = await desktopClient.approveAgendaTask({
										taskId: saved.taskId,
										expectedRevision: saved.revision,
										allWorkspaces: true,
									});
									setDraftRevision(approved.revision);
									await desktopClient.startFactoryQueue([approved]);
								})
							}
						>
							{designActive ? "Preparing plan…" : "Approve and run"}
						</Button>
					</>
				) : !task.archivedAt &&
					(task.status === "cancelled" || task.status === "expired") ? (
					<p className="text-xs text-muted-foreground">
						This task is closed. Create a new task for further changes.
					</p>
				) : null}
			</div>
		</Tabs>
	);
}

"use client";

import type {
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	FactoryTaskConfig,
	FactoryWorkflowConfig,
} from "@cline/shared";
import {
	applyFactoryAutonomyDefaults,
	DEFAULT_FACTORY_AGENTS,
	FACTORY_FEEDBACK_ANALYSIS_STALE_MS,
	factoryPlanApprovalBlocker,
	factoryRepositoryRelative,
	factoryTaskConfigSchema,
	formatFactoryId,
	isFactoryHandsOff,
	selectFactoryReviewAgents,
} from "@cline/shared/browser";
import { AgentAskQuestion } from "@cline/ui";
import {
	AlertTriangle,
	ArrowUpRight,
	CheckCircle2,
	Eye,
	FileText,
	Loader2,
	MessageCircleQuestion,
	Pencil,
	RefreshCw,
	Sparkles,
	ThumbsDown,
	ThumbsUp,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { z } from "zod";
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
import { Button } from "@/components/ui/button";
import { MemoizedMarkdown } from "@/components/ui/markdown";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
	FactoryGuidanceDiffView,
	parseGuidanceDiff,
} from "@/components/views/chat/messages/factory-guidance-approval";
import type { AskQuestionRequestItem } from "@/hooks/chat-session/types";
import { useFactoryLiveActivity } from "@/hooks/use-factory-live-activity";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import {
	currentFactoryConclusion,
	factoryAutoApprovalBlocker,
	factoryAutoApprovalWaiting,
	factoryOpenFindings,
	factoryPlanFault,
	factoryPlanFaultStopped,
	factoryPublishFailureReason,
	factoryRetryPath,
	factoryReviewRequired,
	factoryScopingWait,
	isReplayReviewQueued,
} from "@/lib/factory-attention";
import {
	FACTORY_ACTIVITY,
	FACTORY_CARD,
	FACTORY_DETAILS,
	FACTORY_FEEDBACK,
	FACTORY_OPEN_FINDINGS,
	FACTORY_PANEL,
	FACTORY_PROOF,
	FACTORY_RECOVERY,
	FACTORY_ROLE_LABEL,
	factoryApprovalReasonText,
	factoryReviewRequest,
} from "@/lib/factory-copy";
import {
	factoryFeedbackRowState,
	requestFactoryDiscussion,
} from "@/lib/factory-feedback";
import { cn } from "@/lib/utils";
import {
	defaultFactoryPanelTab,
	FACTORY_NARROW_CARD,
	FactoryArtifactPanel,
	FactoryChangesPane,
	FactoryCheckRow,
	FactoryCiStatus,
	FactoryCopyPathButton,
	type FactoryPanelSection,
	type FactoryPanelTab,
	FactoryStageRows,
	factoryKnownSessions,
	useFactoryCardWidth,
	useFactoryPanelTab,
} from "./factory-artifact-panel";
import { FactoryComparison } from "./factory-comparison";
import {
	FactoryChecksEditor,
	FactoryDetailConfiguration,
	FactoryVerificationSetup,
	factoryChecksBlockSave,
} from "./factory-detail-configuration";
import {
	AcceptanceCriteria,
	AcceptanceResults,
	EvidencePreview,
	FactoryErrorDetails,
	ReviewResult,
	summarizeFactoryError,
} from "./factory-detail-evidence";
import {
	activeFactorySessions,
	factoryLiveSessions,
	rememberFactoryWatchOrigin,
} from "./factory-live";
import { FactoryAgentLanes } from "./factory-live-transcript";
import { FactoryProof } from "./factory-proof";
import {
	FactoryFindingList,
	FactoryTaskHeader,
	factoryAwaitingStart,
	factoryExecutionStage,
	factoryHasVerifier,
	factoryScopingStopped,
	factoryScopingStopReason,
} from "./factory-task-header";
import { Panel } from "./factory-ui";

/**
 * A feature's config before it has one, from an optional reusable workflow.
 * Publishing is left to the schema so hands-off workflows publish and watch a
 * draft PR unless the card turns that off.
 */
export function defaultFactoryTaskConfig(
	workflow: Partial<FactoryWorkflowConfig> = {},
): FactoryTaskConfig {
	return factoryTaskConfigSchema.parse(
		applyFactoryAutonomyDefaults({
			execution: "local",
			approval: "required",
			maxRepairRounds: 2,
			checks: [],
			...workflow,
		}),
	);
}
/** New work and new workflows run hands-off unless the user chooses otherwise. */
export const DEFAULT_FACTORY: FactoryTaskConfig = defaultFactoryTaskConfig({
	autonomy: "hands_off",
	approval: "automatic",
});

const taskEvidenceEventSchema = z.object({
	task: z.object({ taskId: z.string() }),
});
const CONCLUSION_LABELS = {
	already_fixed: "Already fixed",
	duplicate: "Duplicate",
	no_change: "No change needed",
} as const;

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
	onOpenTask,
	questions,
	onAnswer,
}: {
	drafts: Map<string, FactoryDraft>;
	task: AgendaTaskRecord;
	onRefresh: () => Promise<void>;
	onClose: () => void;
	onOpenTask: (taskId: string) => void;
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
	const [startedDesignSession, setDesignSession] = useState<string>();
	const replay = task.factory?.replay;
	// A replay reuses its source brief; its review has no designer transcript.
	const designSession = replay
		? undefined
		: (startedDesignSession ??
			task.factoryDesignProgress?.designerSessionId ??
			(task.factory?.intake ? undefined : task.originSessionId));
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
	const editable =
		!task.archivedAt &&
		(task.status === "pending_approval" ||
			task.status === "approved" ||
			task.status === "failed");
	// Replay briefs, checks and settings are frozen copies of the source run.
	const briefEditable = editable && !replay;
	const designActive =
		editable &&
		!task.error &&
		task.factoryDesignProgress?.revision === task.revision &&
		task.factoryDesignProgress.phase !== "complete";
	const replayReviewQueued = isReplayReviewQueued(task);
	const conclusion = currentFactoryConclusion(task);
	// A failed review keeps its progress and blockers clear it; either way the
	// unchanged brief is reviewed again.
	const replayReviewRetryable =
		Boolean(replay) &&
		editable &&
		Boolean(task.error) &&
		(task.factoryDesignProgress?.revision !== task.revision ||
			task.factoryDesignProgress.phase !== "complete");
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
	const designProgress = task.factoryDesignProgress;
	const currentDesign =
		designProgress?.revision === task.revision ? designProgress : undefined;
	const handsOff = isFactoryHandsOff(task.factory);
	const liveSessions = factoryLiveSessions(
		task,
		matchesTask ? activeFactorySessions(state?.attempts) : [],
	);
	// Every role session known for the card, finished ones included, so the
	// Live tab keeps a transcript after its session ends.
	const knownSessions = factoryKnownSessions({
		task,
		designSession,
		state: matchesTask ? state : undefined,
	});
	const liveActivity = useFactoryLiveActivity([
		...liveSessions.map((session) => session.sessionId),
		...knownSessions.map((session) => session.sessionId),
	]);
	const [feedbackOpen, setFeedbackOpen] = useState(false);
	// More → Rate on an answered card reopens the choice to change it.
	const [changingRating, setChangingRating] = useState(false);
	// Whether the feedback row is on screen; More offers Rate only when it is
	// not (or is already answered), so one surface has one control for it.
	const [feedbackRowElement, setFeedbackRowElement] =
		useState<HTMLElement | null>(null);
	const [feedbackRowVisible, setFeedbackRowVisible] = useState(false);
	useEffect(() => {
		if (!feedbackRowElement || typeof IntersectionObserver === "undefined") {
			setFeedbackRowVisible(false);
			return;
		}
		const observer = new IntersectionObserver((entries) => {
			const entry = entries.at(-1);
			if (entry) setFeedbackRowVisible(entry.isIntersecting);
		});
		observer.observe(feedbackRowElement);
		return () => observer.disconnect();
	}, [feedbackRowElement]);
	// A running analysis reads as failed once it is stale (the Hub stopped
	// mid-analysis), so the row re-renders when that time comes.
	const analysis = state?.audit?.analysis;
	const [feedbackNow, setFeedbackNow] = useState(() => Date.now());
	useEffect(() => {
		if (analysis?.status !== "running") return;
		const due =
			Date.parse(analysis.startedAt) +
			FACTORY_FEEDBACK_ANALYSIS_STALE_MS -
			Date.now();
		if (!Number.isFinite(due)) return;
		const timer = window.setTimeout(
			() => setFeedbackNow(Date.now()),
			Math.max(0, due) + 1_000,
		);
		return () => window.clearTimeout(timer);
	}, [analysis?.status, analysis?.startedAt]);
	const [editingPlan, setEditingPlan] = useState(false);
	// The revision an edited hands-off plan was saved as; scoping restarts.
	const [rescopeSavedRevision, setRescopeSavedRevision] = useState<number>();
	const [briefExpanded, setBriefExpanded] = useState(false);
	const reviewAgents =
		currentDesign && !dirty
			? selectFactoryReviewAgents(
					currentDesign.agents,
					currentDesign.reviewSelection,
				)
			: (config.agents ?? DEFAULT_FACTORY_AGENTS);
	// Saving a draft creates a new revision, so its saved design and review no
	// longer apply to it.
	const approvalPlan = dirty
		? {
				...task,
				instructions,
				factory: config,
				factoryDesignProgress: undefined,
				factoryDesignReview: undefined,
			}
		: { ...task, factory: config };
	// Core's blockers are mapped to plain words for display.
	const approvalReason = factoryApprovalReasonText(
		questions.length > 0
			? "Answer the agent’s question so scoping can continue."
			: replayReviewQueued
				? "This replay's plan review is queued and starts automatically. Approval is available after it passes."
				: designActive
					? task.factoryDesignProgress?.phase === "reviewing"
						? "Agents are reviewing the plan."
						: "The agent is preparing the plan and verification checks."
					: dirty &&
							config.reviewMode !== "adaptive" &&
							reviewAgents.planReviewers.length > 0
						? "Draft changes need a new plan review. Refine the design to save and review them."
						: factoryPlanApprovalBlocker(approvalPlan),
	);
	// Hands-off work scopes, approves and runs itself; manual steps appear only
	// for a real decision (a question, a blocked plan, required approval, a
	// conclusion) or once it stops.
	// A held card waits for the user to start it.
	const held = task.factory?.hold === true;
	const autoProgress =
		isFactoryHandsOff(task.factory) &&
		!held &&
		!task.archivedAt &&
		!task.error &&
		!dirty &&
		!conclusion &&
		questions.length === 0 &&
		!(
			task.factory &&
			factoryAutoApprovalBlocker({ ...task, factory: task.factory })
		) &&
		(task.status === "approved" ||
			task.status === "in_progress" ||
			(task.status === "pending_approval" &&
				(currentDesign?.phase === "complete"
					? task.factory?.approval === "automatic"
					: // Without a plan, only queued or live scoping continues on its own;
						// otherwise the card offers Start scoping.
						designActive || factoryScopingWait(task) === "queued")));
	// Nothing will start this card: the header's Start is its one action, so
	// the brief offers no Start scoping and the footer no approval. Once the
	// user edits the plan by hand, saving and approving it come back.
	const awaitingStart =
		!dirty &&
		factoryAwaitingStart(task, {
			autoProgress,
			designActive,
			approvalReason,
		});
	function navigate(action: () => void) {
		if (dirty) setPendingNavigation(() => action);
		else action();
	}
	/** Opens a role session; resolves once opened, rejects if it is gone. */
	function openSession(sessionId: string): Promise<void> {
		rememberFactoryWatchOrigin({
			sessionId,
			taskId: task.taskId,
			title: task.title,
		});
		if (dirty) {
			setPendingNavigation(() => () => {
				void onOpenSession(sessionId).catch(() => undefined);
			});
			return Promise.resolve();
		}
		return onOpenSession(sessionId);
	}

	function toggleArchive() {
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
	function startEditPlan() {
		if (handsOff) setEditingPlan(true);
		else setPage("plan");
		setEditing(true);
	}
	function discardPlanEdits() {
		setInstructions(savedDraft.instructions);
		setConfig(savedDraft.config);
		setDraftRevision(savedDraft.revision);
		setEditing(false);
		setEditingPlan(false);
	}
	function recordFeedback(finding: string) {
		void perform(async () => {
			await desktopClient.invoke("task.factory.audit", {
				taskId: task.taskId,
				finding,
				allWorkspaces: true,
			});
			setFeedbackOpen(false);
		});
	}
	/** The person's decision on the rule Factory proposed from their note. */
	function resolveFeedback(
		decision: "save" | "discard" | "retry",
		expectedHash?: string,
	) {
		void perform(async () => {
			await desktopClient.invoke("task.factory.audit.resolve", {
				taskId: task.taskId,
				decision,
				...(expectedHash ? { expectedHash } : {}),
				allWorkspaces: true,
			});
		});
	}
	/** Opens Ask Factory beside the card with the note and verdict as a draft. */
	function discussFeedback(verdict?: string) {
		const shortId = task.factoryNumber
			? formatFactoryId(task.factoryNumber)
			: undefined;
		requestFactoryDiscussion({
			taskId: task.taskId,
			shortId,
			draft: FACTORY_FEEDBACK.discussDraft(
				shortId ?? `“${task.title}”`,
				state?.audit?.finding ?? "",
				verdict,
			),
		});
	}
	const cancellable =
		!task.archivedAt && (task.status === "in_progress" || designActive);
	// Core decides at delivery whether the result needs the user's review;
	// runs from before that keep the old rule (manual work only).
	const canStamp = Boolean(
		factoryReviewRequired(task, state) &&
			state &&
			matchesTask &&
			task.status === "completed" &&
			!state.humanApproval &&
			!state.pullRequestWatch?.pending &&
			questions.length === 0 &&
			(state.phase === "ready" ||
				(state.phase === "watching" &&
					state.pullRequestChecks?.status === "passed" &&
					state.pullRequestChecks.headCommit === state.candidate?.commit)) &&
			state.candidate,
	);
	// Action failures stay short and red; a stopped run's stored error is
	// summarized instead, with the raw log behind a disclosure.
	const alert = error || evidenceError;
	const failureText =
		(currentEvidence ? state?.error : undefined) || task.error || undefined;
	// A draft PR that could not be opened: the headline says so; the reason
	// is core's one sentence without the repeated lead-in.
	const publishError = currentEvidence ? state?.pullRequestError : undefined;
	const publishFailure =
		(currentEvidence && state?.pullRequestUrl
			? undefined
			: publishError
				? (factoryPublishFailureReason(publishError) ?? publishError)
				: factoryPublishFailureReason(failureText)) || undefined;
	// Stopped at the repair limit with the draft PR open: the header lists
	// the findings and offers the PR, a fix and the review stamp instead.
	const openFindings = factoryOpenFindings(
		task,
		currentEvidence ? state : undefined,
	);
	// Core's "waiting for approval" note is not a failure; the header says it.
	const failure =
		failureText && !openFindings && factoryAutoApprovalWaiting(task) === null
			? summarizeFactoryError(failureText)
			: undefined;
	const planFault = factoryPlanFault(task, currentEvidence ? state : undefined);
	// Scoping ran and stopped before the plan settled.
	const scopingStopped = factoryScopingStopped(task);
	const stopped =
		!task.archivedAt &&
		(task.status === "failed" ||
			scopingStopped ||
			Boolean(currentEvidence && state?.phase === "blocked"));
	// Factory already re-scoped a plan whose checks still cannot work; only
	// editing the plan fixes it, so Try again is not offered.
	const canRetry =
		stopped &&
		task.status === "failed" &&
		editable &&
		!factoryPlanFaultStopped(task);
	function retry() {
		void perform(async () => {
			const saved = await save();
			// A plan fault restarts scoping. A still-approved plan goes back to
			// the Factory queue, which decides whether to re-run or re-scope
			// it; an edited, approvable plan is approved; anything else scopes.
			const path = factoryRetryPath(saved, {
				state: currentEvidence ? state : undefined,
				approvable:
					!dirty &&
					currentDesign?.phase === "complete" &&
					!factoryPlanApprovalBlocker({ ...saved, factory: config }),
			});
			if (path === "queue") await desktopClient.startFactoryQueue([saved]);
			else if (path === "approve") {
				const approved = await desktopClient.approveAgendaTask({
					taskId: saved.taskId,
					expectedRevision: saved.revision,
					allWorkspaces: true,
				});
				setDraftRevision(approved.revision);
			} else await startScoping(saved.taskId);
		});
	}
	/** Accept records the human review (the stamp) only; feedback stays optional. */
	function acceptResult() {
		void perform(async () => {
			await desktopClient.invoke("task.factory.stamp", {
				taskId: task.taskId,
				expectedHead: state?.candidate?.commit,
				allWorkspaces: true,
			});
		});
	}
	async function startScoping(taskId: string) {
		const result = await desktopClient.designFactoryTask(taskId);
		setDesignSession(result.sessionId);
		setDesignStarted(true);
	}
	/** Saves an edited hands-off plan; core sends it back to scoping. */
	async function savePlan() {
		const saved = await save();
		setEditingPlan(false);
		setEditing(false);
		if (handsOff && saved.revision !== task.revision)
			setRescopeSavedRevision(saved.revision);
	}
	const evidenceNote = !transportReady
		? " (connection unavailable; showing saved results)"
		: runsLoading
			? " (refreshing…)"
			: evidenceError
				? " (couldn't refresh; showing saved results)"
				: currentEvidence
					? dirty
						? " (saved plan; draft edits not verified)"
						: ""
					: " (from an earlier attempt)";
	const delivered = Boolean(
		state &&
			currentEvidence &&
			!task.archivedAt &&
			task.status === "completed" &&
			(state.pullRequestUrl || state.phase === "ready" || state.audit) &&
			state.candidate,
	);
	// A delivered result core asked the user to review, until it is marked.
	const reviewPending =
		delivered && state?.humanReview?.required && !state.humanApproval
			? state.humanReview
			: undefined;
	const hasVerifier = factoryHasVerifier(task, matchesTask ? state : undefined);
	const waitingForSlot =
		!liveSessions.length &&
		task.factoryQueued !== undefined &&
		!held &&
		!task.archivedAt;
	const showSaveBrief =
		editable &&
		briefEditable &&
		(dirty || (!handsOff && !stopped && !awaitingStart));
	const showApprove = editable && !autoProgress && !stopped && !awaitingStart;
	// Accept lives in the header; the footer keeps saving, approval and PR
	// follow-up.
	const footerVisible = canFollowUp || showSaveBrief || showApprove;
	// Accept merges "Mark as reviewed" with "Looks good": on a result core
	// asked the user to review, or one stopped with its draft PR open.
	const acceptable =
		canStamp || Boolean(openFindings && editable && !dirty && state?.candidate);
	const accept = acceptable
		? {
				onAccept: acceptResult,
				disabled: !currentEvidence || dirty || Boolean(task.archivedAt),
				reason: openFindings
					? FACTORY_OPEN_FINDINGS.next(openFindings.findings.length)
					: reviewPending
						? factoryReviewRequest(reviewPending.reason)
						: undefined,
			}
		: undefined;
	const [detailsOpen, setDetailsOpen] = useState(false);

	// The artifact panel: Live | Changes | Checks | PR.
	const panelStage =
		state && matchesTask ? factoryExecutionStage(state, task.error) : undefined;
	const panelDefault = defaultFactoryPanelTab(panelStage, {
		working:
			liveSessions.length > 0 || designActive || task.status === "in_progress",
		delivered,
		needsReview: Boolean(reviewPending),
		openFindings: Boolean(openFindings),
		failed: stopped,
		hasRun: Boolean(state),
	});
	const [chosenTab, setPanelTab] = useFactoryPanelTab(
		task.taskId,
		panelDefault,
	);
	const verification = state?.candidate?.verification;
	// A tab with nothing to show is left out; Agents always stays.
	const tabShown: Record<FactoryPanelTab, boolean> = {
		live: true,
		changes: Boolean(state?.candidate?.commit),
		checks: Boolean(
			state?.candidate?.checks.length ||
				state?.candidate?.stages?.length ||
				state?.stagePlan?.unapproved.length ||
				verification ||
				(state?.error && !currentEvidence),
		),
		pr: Boolean(
			(!state?.pullRequestUrl && publishFailure) ||
				(state?.pullRequestChecks && currentEvidence) ||
				state?.reviewEscalation ||
				state?.candidate?.reviews.length,
		),
	};
	// A chosen tab that is not shown falls back to the default, then Agents.
	const panelTab =
		chosenTab &&
		([chosenTab, panelDefault].find((item) => item && tabShown[item]) ??
			"live");
	// The Checks tab lists the failed checks with their output.
	const checksInPanel =
		panelTab !== null && Boolean(state?.candidate?.checks.length);
	/** Saves any draft and (re)starts scoping. */
	const rescope =
		editable && !busy
			? () =>
					void perform(async () => {
						const saved = await save();
						await startScoping(saved.taskId);
					})
			: undefined;
	const header = (
		<FactoryTaskHeader
			task={task}
			busy={busy}
			designActive={designActive}
			state={currentEvidence ? state : undefined}
			approvalReason={approvalReason}
			autoProgress={autoProgress}
			onBack={() => navigate(onClose)}
			onArchive={toggleArchive}
			onStop={
				cancellable
					? () =>
							void perform(async () => {
								await desktopClient.cancelAgendaTask({
									taskId: task.taskId,
									expectedRevision: task.revision,
									allWorkspaces: true,
								});
							})
					: undefined
			}
			live={{
				sessions: liveSessions,
				activity: liveActivity,
				waiting: waitingForSlot ? FACTORY_ACTIVITY.waitingForSlot : undefined,
			}}
			runs={runs}
			onStart={rescope}
			onFixFindings={openFindings && canRetry ? retry : undefined}
			findingsShownElsewhere={panelTab !== null}
			accept={accept}
			delivery={
				delivered && state
					? {
							pullRequestUrl: state.pullRequestUrl,
							branch: state.workspace.branch,
							onViewChanges: () => {
								setPanelTab("changes");
								setMergedOnPanel(true);
							},
						}
					: undefined
			}
			// While the plan is open for editing, Cancel editing is the plan's
			// action. Manual cards edit from the Brief's own Edit button.
			// Rate is offered only while the unanswered row is off screen, or
			// to change an answer; it opens the row's own note box.
			onRate={
				delivered && (state?.audit?.reviewedAt || !feedbackRowVisible)
					? () => {
							if (state?.audit?.reviewedAt) {
								setChangingRating(true);
								setAuditFinding(state.audit.finding ?? "");
							}
							setFeedbackOpen(true);
							requestAnimationFrame(() => {
								const field = document.getElementById(
									"factory-feedback-finding",
								);
								field?.scrollIntoView?.({ block: "nearest" });
								field?.focus();
							});
						}
					: undefined
			}
			onEditPlan={
				briefEditable && !editing && !editingPlan && (handsOff || stopped)
					? startEditPlan
					: undefined
			}
			failure={
				stopped && !openFindings
					? {
							reason: scopingStopped
								? factoryScopingStopReason(task.error)
								: (publishFailure ?? failure?.headline),
							onRetry: scopingStopped ? rescope : canRetry ? retry : undefined,
							planFault,
							planFaultStopped: factoryPlanFaultStopped(task),
						}
					: undefined
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
	);
	const leaveDialog = (
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
						Your draft has not been saved. Stay here to save it, or discard the
						draft and continue.
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
	);
	const alertBlock = alert ? (
		<p
			role="alert"
			className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
		>
			<AlertTriangle className="mt-0.5 size-4 shrink-0" />
			<span className="line-clamp-4 min-w-0 break-words">{alert}</span>
		</p>
	) : null;
	const failureBlock = failure ? (
		<>
			{stopped ? null : (
				<p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
					<AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
					<span className="min-w-0 break-words">{failure.headline}</span>
				</p>
			)}
			<FactoryErrorDetails
				summary={checksInPanel ? { ...failure, checks: [] } : failure}
			/>
		</>
	) : null;
	const questionBlock =
		questions.length && !task.archivedAt ? (
			<section className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-5 py-4">
				<h3 className="flex items-center gap-2 text-sm font-semibold">
					<MessageCircleQuestion className="size-4 text-amber-600 dark:text-amber-400" />
					Needs your answer
				</h3>
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
		) : null;
	const conclusionBlock = conclusion ? (
		<section
			aria-label="Designer conclusion"
			className="space-y-3 rounded-lg border border-amber-500/30 px-5 py-4"
		>
			<h3 className="text-sm font-semibold">
				No build needed · {CONCLUSION_LABELS[conclusion.outcome]}
			</h3>
			<p className="whitespace-pre-wrap text-sm">{conclusion.rationale}</p>
			{conclusion.duplicateOf ? (
				<p className="text-sm">
					Duplicate of{" "}
					<Button
						variant="link"
						className="h-auto p-0"
						onClick={() => {
							const target = conclusion.duplicateOf ?? "";
							if (/^https?:\/\//.test(target)) void openExternalUrl(target);
							else navigate(() => onOpenTask(target));
						}}
					>
						{conclusion.duplicateOf}
						<ArrowUpRight className="ml-1 size-3" />
					</Button>
				</p>
			) : null}
			<div className="space-y-1">
				<h4 className="text-xs font-medium text-muted-foreground">Evidence</h4>
				<ul className="list-disc space-y-1 pl-5 text-sm">
					{conclusion.evidence.map((item) => (
						<li key={item} className="break-words">
							{item}
						</li>
					))}
				</ul>
			</div>
			{editable ? (
				<div className="flex flex-wrap gap-2">
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						onClick={toggleArchive}
					>
						Dismiss
					</Button>
					{briefEditable ? (
						<Button
							size="sm"
							variant="outline"
							disabled={busy}
							onClick={startEditPlan}
						>
							Edit brief
						</Button>
					) : null}
				</div>
			) : null}
		</section>
	) : null;
	// What Factory made of the person's note, if they left one.
	const feedbackState = factoryFeedbackRowState(
		analysis,
		Math.max(feedbackNow, Date.now()),
	);
	const proposedDiff =
		feedbackState.kind === "proposed"
			? parseGuidanceDiff(feedbackState.proposal.diff)
			: undefined;
	const feedbackChoice = (
		<>
			<div className="flex flex-wrap items-center gap-2">
				{/* Accept records the good feedback on a card waiting for review. */}
				{accept ? null : (
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						onClick={() => {
							recordFeedback("");
							setChangingRating(false);
						}}
					>
						<ThumbsUp className="mr-1.5 size-3.5" />
						{FACTORY_PROOF.good}
					</Button>
				)}
				<Button
					size="sm"
					variant="outline"
					disabled={busy}
					aria-expanded={feedbackOpen}
					aria-controls="factory-feedback"
					onClick={() => setFeedbackOpen((open) => !open)}
				>
					<ThumbsDown className="mr-1.5 size-3.5" />
					{FACTORY_PROOF.somethingOff}
				</Button>
			</div>
			{feedbackOpen ? (
				<div id="factory-feedback" className="space-y-2">
					<label
						htmlFor="factory-feedback-finding"
						className="block text-sm font-medium"
					>
						{FACTORY_PROOF.feedbackQuestion}
					</label>
					<Textarea
						id="factory-feedback-finding"
						autoFocus
						value={auditFinding}
						onChange={(event) => setAuditFinding(event.target.value)}
						disabled={busy}
						rows={4}
					/>
					<Button
						size="sm"
						disabled={busy || !auditFinding.trim()}
						onClick={() => {
							recordFeedback(auditFinding);
							setChangingRating(false);
						}}
					>
						{FACTORY_PROOF.sendFeedback}
					</Button>
				</div>
			) : null}
		</>
	);
	const feedbackOutcome = (() => {
		switch (feedbackState.kind) {
			case "running":
				return (
					<output className="flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="size-3.5 animate-spin" />
						{FACTORY_FEEDBACK.checking}
					</output>
				);
			case "proposed":
				return (
					<div className="space-y-2" data-testid="factory-feedback-proposal">
						{feedbackState.summary ? (
							<p className="text-sm">{feedbackState.summary}</p>
						) : null}
						<p className="text-xs text-muted-foreground">
							{feedbackState.target}
						</p>
						{feedbackState.evidence.length ? (
							<div className="text-xs text-muted-foreground">
								<p>{FACTORY_FEEDBACK.evidence}</p>
								<ul className="list-disc space-y-0.5 pl-4">
									{feedbackState.evidence.map((quote) => (
										<li key={quote} className="break-words">
											{quote}
										</li>
									))}
								</ul>
							</div>
						) : null}
						{proposedDiff ? (
							<FactoryGuidanceDiffView diff={proposedDiff} />
						) : null}
						{feedbackState.proposal.scope === "repository" ? (
							<p className="text-xs text-muted-foreground">
								{FACTORY_FEEDBACK.repositoryNote}
							</p>
						) : null}
						<div className="flex flex-wrap gap-2">
							<Button
								size="sm"
								disabled={busy || !proposedDiff}
								onClick={() =>
									resolveFeedback("save", feedbackState.proposal.hash)
								}
							>
								{FACTORY_FEEDBACK.save}
							</Button>
							<Button
								size="sm"
								variant="outline"
								disabled={busy}
								onClick={() => resolveFeedback("discard")}
							>
								{FACTORY_FEEDBACK.discard}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								disabled={busy}
								onClick={() => discussFeedback(feedbackState.summary)}
							>
								{FACTORY_FEEDBACK.discuss}
							</Button>
						</div>
					</div>
				);
			case "no_rule":
				return feedbackState.summary ? (
					<p className="text-sm">{feedbackState.summary}</p>
				) : null;
			case "failed":
				return (
					<div className="space-y-2">
						<p className="text-sm text-muted-foreground">
							{feedbackState.message}
						</p>
						<div className="flex flex-wrap gap-2">
							<Button
								size="sm"
								variant="outline"
								disabled={busy}
								onClick={() => resolveFeedback("retry")}
							>
								{FACTORY_FEEDBACK.tryAgain}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								disabled={busy}
								onClick={() => discussFeedback(feedbackState.message)}
							>
								{FACTORY_FEEDBACK.discuss}
							</Button>
						</div>
					</div>
				);
			case "saved":
				return <p className="text-sm">{FACTORY_FEEDBACK.saved}</p>;
			case "discarded":
				return (
					<p className="text-sm text-muted-foreground">
						{FACTORY_FEEDBACK.discarded}
					</p>
				);
			default:
				return null;
		}
	})();
	// A delivered or review-needed card: the proof receipt is the left
	// column's main content; the header carries the state and its action.
	// Feedback is optional: the note, then what Factory made of it, and the
	// one place to save or discard its rule.
	const feedbackRow = (
		<section
			ref={setFeedbackRowElement}
			className="space-y-2 border-t pt-3"
			aria-label="Feedback"
		>
			{state?.audit?.reviewedAt && !changingRating ? (
				state.audit.finding ? (
					<>
						<p className="text-xs text-muted-foreground">
							{FACTORY_FEEDBACK.yourNote}
						</p>
						<p className="whitespace-pre-wrap break-words rounded bg-muted/40 px-3 py-2 text-sm">
							{state.audit.finding}
						</p>
						{feedbackOutcome}
					</>
				) : (
					<p className="text-sm">{FACTORY_PROOF.feedbackRecorded}</p>
				)
			) : (
				feedbackChoice
			)}
		</section>
	);
	const deliveredBlock =
		(delivered || (openFindings && currentEvidence)) && state?.candidate ? (
			<FactoryProof state={state} hasVerifier={hasVerifier}>
				{/* Feedback rates a delivery; other states have none. */}
				{delivered ? feedbackRow : null}
			</FactoryProof>
		) : null;
	// The page title already names the work; a leading heading that repeats
	// it is not shown again.
	const shownBrief = factoryBriefWithoutTitle(instructions, task.title);
	const briefLong =
		instructions.length > 600 || instructions.split("\n").length > 8;
	const briefEditor = (
		<>
			{designStarted ? (
				<output className="flex items-center gap-2 rounded-lg bg-sky-500/10 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
					<Sparkles className="size-3.5 shrink-0" />
					Design interview started. Questions will appear here as the agent
					reads the context.
				</output>
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
					autoFocus
					aria-label="Design brief"
					className="font-mono text-sm leading-6"
					disabled={!briefEditable || busy}
					value={instructions}
					onChange={(event) => setInstructions(event.target.value)}
					rows={14}
				/>
			) : handsOff && briefLong && !briefExpanded ? (
				<>
					<div className="max-h-48 overflow-hidden" data-testid="factory-brief">
						<MemoizedMarkdown
							content={shownBrief || "No plan has been recorded yet."}
							classNames="text-sm break-words [&_:not(pre)>code]:break-all"
						/>
					</div>
					<Button
						variant="link"
						size="sm"
						className="h-auto p-0 text-xs"
						aria-expanded={false}
						onClick={() => setBriefExpanded(true)}
					>
						Show all
					</Button>
				</>
			) : (
				<MemoizedMarkdown
					content={shownBrief || "No plan has been recorded yet."}
					classNames="text-sm break-words [&_:not(pre)>code]:break-all"
				/>
			)}
			{config.documents?.length ? (
				<p className="text-xs text-muted-foreground">
					Reference docs: {config.documents.map((doc) => doc.name).join(", ")}
				</p>
			) : null}
		</>
	);
	// A finished card has nothing left to scope. A finished, unedited plan
	// is edited from More (hands-off) or the Brief's Edit (manual), so no
	// second button here would open the same editor.
	const offerDesignAction =
		task.status !== "completed" &&
		!autoProgress &&
		!(handsOff && stopped) &&
		!scopingStopped &&
		!awaitingStart &&
		!(
			!dirty &&
			designProgress?.revision === task.revision &&
			designProgress.phase === "complete"
		);
	const designActionButton = replay ? (
		replayReviewQueued || replayReviewRetryable || designActive ? (
			<Button
				size="sm"
				variant="outline"
				id="factory-design-action"
				disabled={busy || !replayReviewRetryable}
				onClick={() =>
					void perform(async () => {
						await desktopClient.designFactoryTask(task.taskId);
					})
				}
			>
				{replayReviewRetryable
					? "Retry plan review"
					: replayReviewQueued
						? "Plan review queued"
						: "Plan review in progress"}
			</Button>
		) : null
	) : offerDesignAction ? (
		<Button
			size="sm"
			variant="outline"
			id="factory-design-action"
			disabled={busy || !editable}
			onClick={() =>
				void perform(async () => {
					const saved = await save();
					await startScoping(saved.taskId);
				})
			}
		>
			{held ? "Start" : designSession ? "Refine design" : "Start scoping"}
		</Button>
	) : null;
	const replayNote = replay ? (
		<p className="rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
			Replay variant “{replay.label}”: the brief, checks and Git base (
			{replay.baseBranch}@{replay.baseCommit.slice(0, 12)}) are copied from the
			source run and can't be edited.{" "}
			{reviewAgents.planReviewers.length
				? `Creating the replay queued a fresh plan review with this variant's workflow${
						replayReviewQueued
							? "; it has not started yet"
							: designActive
								? "; it is in progress"
								: ""
					}.`
				: "This variant's workflow has no plan reviewers, so it skips plan review."}{" "}
			Nothing is implemented until you approve it; it then runs in an isolated
			Git worktree on your machine, which is not a security sandbox. Publishing
			is off.
		</p>
	) : null;
	const criteriaHasHeading = Boolean(
		state?.candidate &&
			currentEvidence &&
			state.inputSnapshot?.factory.acceptanceCriteria?.length,
	);
	const criteriaBlock =
		state?.candidate && currentEvidence ? (
			// While working, the requirements are a checklist that fills in as
			// checks land.
			<AcceptanceResults
				criteria={state.inputSnapshot?.factory.acceptanceCriteria}
				candidate={state.candidate}
				inProgress={task.status === "in_progress"}
			/>
		) : config.acceptanceCriteria?.length ? (
			<AcceptanceCriteria
				items={config.acceptanceCriteria.map((criterion) => ({ criterion }))}
			/>
		) : (
			<p className="text-xs text-muted-foreground">
				No acceptance criteria are recorded for this plan.
			</p>
		);
	const reviewTeam =
		currentDesign?.reviewSelection && !dirty ? (
			<section
				className="space-y-2 rounded-lg border bg-card px-5 py-4 text-sm"
				aria-label="Selected review team"
			>
				<h3 className="font-semibold">
					Review team ·{" "}
					{currentDesign.reviewSelection.impact.replaceAll("_", " ")}
				</h3>
				<p>{currentDesign.reviewSelection.rationale}</p>
				<dl className="space-y-1 text-xs text-muted-foreground">
					{(
						[
							["Plan reviewers", reviewAgents.planReviewers],
							["Code reviewers", reviewAgents.reviewers],
						] satisfies [string, typeof reviewAgents.reviewers][]
					).map(([label, reviewers]) => (
						<div key={label} className="flex gap-2">
							<dt>{label}:</dt>
							<dd>
								{reviewers
									.map(
										(agent) =>
											agent.modelSelection?.modelId ??
											agent.resolvedProfile?.modelId ??
											agent.profile ??
											"Feature model",
									)
									.join(" · ") || "None"}
							</dd>
						</div>
					))}
					<div>
						<dt className="inline">Affected consumers: </dt>
						<dd className="inline">
							{currentDesign.reviewSelection.consumers.join(" · ")}
						</dd>
					</div>
				</dl>
			</section>
		) : null;
	const planReview = task.factoryDesignReview ? (
		<Panel
			title={
				<>
					Plan review
					{dirty || task.factoryDesignReview.revision !== task.revision
						? " (previous draft)"
						: ""}
				</>
			}
		>
			{task.factoryDesignReview.reviews.map((result) => (
				<ReviewResult
					key={result.reviewerIndex}
					label={`Plan reviewer ${result.reviewerIndex + 1}`}
					review={result.review}
					sessionId={result.sessionId}
					onOpenSession={openSession}
					collapsed={handsOff}
				/>
			))}
		</Panel>
	) : null;
	const configuration = (
		<FactoryDetailConfiguration
			config={config}
			disabled={!briefEditable || busy}
			setConfig={setConfig}
			perform={perform}
			readOnly={handsOff && !editingPlan}
			workspaceRoot={task.workspaceRoot}
			// The plan editor or the Checks tab lists them.
			checksShownElsewhere={handsOff && (editingPlan || tabShown.checks)}
		/>
	);
	const refreshButton = (
		<Button
			variant="outline"
			size="sm"
			disabled={runsLoading || !transportReady}
			onClick={() => setEvidenceVersion((version) => version + 1)}
		>
			<RefreshCw
				className={`mr-1.5 size-3.5 ${runsLoading ? "animate-spin motion-reduce:animate-none" : ""}`}
			/>
			{FACTORY_DETAILS.refresh}
		</Button>
	);
	const cardRef = useRef<HTMLDivElement>(null);
	const mainRef = useRef<HTMLDivElement>(null);
	const cardWidth = useFactoryCardWidth(cardRef);
	// Narrow cards: one tab list for the card's sections and the panel.
	const narrow = cardWidth !== undefined && cardWidth < FACTORY_NARROW_CARD;
	// On one column the panel (diff or live view) opens first.
	const [mergedOnPanel, setMergedOnPanel] = useState(true);
	const focusMain = () => mainRef.current?.focus();
	const reviewFindings = (state?.candidate?.reviews ?? []).flatMap((entry) =>
		entry.review.findings.map((finding) => factoryRepositoryRelative(finding)),
	);
	const findingsStrip = openFindings ? (
		<section
			aria-label={FACTORY_PANEL.findingsHeading}
			className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2"
		>
			<h4 className="text-sm font-semibold">
				{FACTORY_OPEN_FINDINGS.headline(openFindings.findings.length)}
			</h4>
			<FactoryFindingList findings={openFindings.findings} />
		</section>
	) : reviewPending && reviewFindings.length ? (
		<section
			aria-label={FACTORY_PANEL.findingsHeading}
			className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2"
		>
			<h4 className="text-sm font-semibold">{FACTORY_PANEL.reviewsHeading}</h4>
			<FactoryFindingList findings={reviewFindings} />
		</section>
	) : null;
	// The Agents tab: one lane per role session, running ones first.
	const runningIds = new Set(liveSessions.map((session) => session.sessionId));
	const livePane = knownSessions.length ? (
		<FactoryAgentLanes
			sessions={[
				...knownSessions,
				...liveSessions.filter(
					(session) =>
						!knownSessions.some(
							(known) => known.sessionId === session.sessionId,
						),
				),
			]}
			runningIds={runningIds}
			activity={liveActivity}
			waiting={waitingForSlot ? FACTORY_ACTIVITY.waitingForSlot : undefined}
			onOpenInChat={(sessionId) =>
				void openSession(sessionId).catch(() => undefined)
			}
		/>
	) : (
		<p className="p-4 text-sm text-muted-foreground">
			{waitingForSlot
				? FACTORY_ACTIVITY.waitingForSlot
				: FACTORY_PANEL.liveIdle()}
		</p>
	);
	const changesPane = (
		<FactoryChangesPane
			taskId={task.taskId}
			runId={run?.runId}
			commit={state?.candidate?.commit}
			workspacePath={state?.workspace.path}
			branch={state?.workspace.branch}
			strip={findingsStrip}
			note={
				state &&
				!state.pullRequestUrl &&
				state.phase === "ready" &&
				currentEvidence &&
				task.status === "completed" &&
				!delivered ? (
					<p className="flex items-center gap-2 text-sm text-success-text">
						<CheckCircle2 className="size-4 shrink-0" />
						Checks and independent review passed. Changes are ready for your
						review on the feature branch.
					</p>
				) : undefined
			}
			onClose={focusMain}
		/>
	);
	const checksPane = (
		<>
			{state?.error && !currentEvidence ? (
				<p className="line-clamp-3 break-words text-sm text-muted-foreground">
					Recorded error: {summarizeFactoryError(state.error).headline}
				</p>
			) : null}
			{state?.candidate?.checks.length ? (
				<section aria-label="Checks" className="space-y-2">
					<h4 className="text-sm font-semibold">Checks</h4>
					<ul className="divide-y rounded-lg border">
						{state.candidate.checks.map((check, index) => (
							<FactoryCheckRow
								key={`${check.name}-${index}`}
								check={check}
								taskId={task.taskId}
								runId={run?.runId ?? ""}
								commit={state.candidate?.commit}
								onEditPlan={briefEditable ? startEditPlan : undefined}
							/>
						))}
					</ul>
				</section>
			) : (
				<p className="text-sm text-muted-foreground">
					{FACTORY_PANEL.noChecks}
				</p>
			)}
			<FactoryStageRows
				stages={state?.candidate?.stages}
				unapproved={state?.stagePlan?.unapproved}
				taskId={task.taskId}
				runId={run?.runId ?? ""}
				commit={state?.candidate?.commit}
			/>
			{verification ? (
				<section
					aria-label={handsOff ? "App test" : "Agent verification"}
					className="space-y-2"
				>
					<ReviewResult
						label={handsOff ? "App test" : "Agent verification"}
						review={verification.review}
						sessionId={verification.sessionId}
						onOpenSession={openSession}
						collapsed={handsOff}
					/>
					{verification.artifacts.map((artifact) => (
						<EvidencePreview
							key={`${run?.runId}:${state?.candidate?.commit}:${artifact.path}`}
							taskId={task.taskId}
							runId={run?.runId ?? ""}
							artifact={artifact}
						/>
					))}
				</section>
			) : null}
		</>
	);
	// The header opens the PR; this tab keeps its CI and the code review.
	const prPane = (
		<>
			{!state?.pullRequestUrl && publishFailure ? (
				<p className="text-sm text-muted-foreground">{publishFailure}</p>
			) : null}
			{state?.pullRequestChecks && currentEvidence ? (
				<FactoryCiStatus checks={state.pullRequestChecks} />
			) : null}
			{state?.reviewEscalation ? (
				<p className="rounded-lg border px-3 py-2 text-sm">
					Review expanded to {state.agents?.reviewers.length} reviewers.{" "}
					{state.reviewEscalation.rationale}
				</p>
			) : null}
			{state?.candidate?.reviews.length ? (
				<section
					aria-label={FACTORY_PANEL.reviewsHeading}
					className="space-y-2"
				>
					<h4 className="text-sm font-semibold">
						{FACTORY_PANEL.reviewsHeading}
					</h4>
					{state.candidate.reviews.map((result) => (
						<ReviewResult
							key={result.reviewerIndex}
							label={`${handsOff ? FACTORY_ROLE_LABEL.reviewer : "Final reviewer"} ${result.reviewerIndex + 1}`}
							review={result.review}
							sessionId={result.sessionId}
							onOpenSession={openSession}
							collapsed={handsOff}
						/>
					))}
				</section>
			) : null}
		</>
	);
	const panes: Partial<Record<FactoryPanelTab, ReactNode>> = {
		live: livePane,
		...(tabShown.changes ? { changes: changesPane } : {}),
		...(tabShown.checks ? { checks: checksPane } : {}),
		...(tabShown.pr ? { pr: prPane } : {}),
	};
	// Refresh lives in More → Details; the panel keeps saying whether the
	// results shown are current.
	const panelActions =
		handsOff && evidenceNote ? (
			<span className="hidden min-w-0 truncate text-xs text-muted-foreground @min-[560px]:inline">
				{evidenceNote.trim().replace(/^\(|\)$/g, "")}
			</span>
		) : null;
	// Replays compare finished work, so the tool stays out of the way while
	// agents run and sits in More → Details on other cards; a replay card is
	// a comparison and shows it open.
	const comparisonTool =
		loadedEvidenceKey !== undefined &&
		(replay || runs.some((item) => item.factory)) &&
		(replay || (task.status !== "in_progress" && !designActive)) ? (
			<FactoryComparison
				task={task}
				runs={runs}
				defaultRunId={run?.runId}
				onOpenTask={(taskId) => navigate(() => onOpenTask(taskId))}
			/>
		) : null;
	const workspace = matchesTask ? state?.workspace : undefined;
	const baseNote =
		workspace?.baseSource === "remote_default" ? (
			<p className="text-xs text-muted-foreground">
				{FACTORY_RECOVERY.builtFromDefault(workspace.baseBranch)}
			</p>
		) : null;
	// The proof receipt carries the cost when it is shown.
	const costLine =
		state && matchesTask && !deliveredBlock ? (
			<p className="text-xs text-muted-foreground">
				{FACTORY_CARD.costLine(
					state.usage
						? `$${state.usage.totals.totalCost.toFixed(2)}`
						: undefined,
					state.attempts?.length ?? 0,
					state.usage?.unknownSessionIds.length ?? 0,
				)}
			</p>
		) : null;
	/**
	 * More → Details: settings and history kept off the default view (plan
	 * version, attempt, worktree, refresh, other models, configuration).
	 */
	const details = (children: ReactNode) => (
		<details
			className="group rounded-lg border bg-card"
			open={editingPlan || detailsOpen}
			onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
			data-testid="factory-details"
		>
			<summary className="cursor-pointer select-none px-5 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
				{FACTORY_DETAILS.heading}
			</summary>
			<div className="space-y-5 border-t px-5 py-5">
				<div
					className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
					data-testid="factory-details-facts"
				>
					<p className="min-w-0">
						{FACTORY_DETAILS.revision(task.revision)}
						{run ? ` · ${FACTORY_DETAILS.attempt(run.attempt)}` : ""}
						{evidenceNote}
					</p>
					{refreshButton}
				</div>
				{workspace?.path ? (
					<div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
						<span className="shrink-0">{FACTORY_DETAILS.worktree}</span>
						<code className="min-w-0 truncate font-mono" title={workspace.path}>
							{workspace.path}
						</code>
						<FactoryCopyPathButton path={workspace.path} />
					</div>
				) : null}
				{children}
			</div>
		</details>
	);
	const footer = footerVisible ? (
		// Pinned to the bottom of the main column (its own scroll on two
		// columns, the page on one), inside the column's width.
		<div
			data-testid="factory-footer"
			className="sticky bottom-0 z-10 mt-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2 rounded-lg border border-t-border bg-background/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.25)] backdrop-blur"
		>
			<div className="mr-auto min-w-0 max-w-2xl flex-1 basis-56 text-xs leading-5 text-muted-foreground">
				{showApprove && approvalReason ? (
					<p
						id="factory-approval-reason"
						className="text-amber-600 dark:text-amber-400"
					>
						{approvalReason}{" "}
						<Button
							variant="link"
							size="sm"
							className="h-auto p-0 text-xs"
							onClick={() => {
								if (handsOff) startEditPlan();
								else setPage("plan");
								requestAnimationFrame(() =>
									document.getElementById("factory-design-action")?.focus(),
								);
							}}
						>
							Open plan
						</Button>
					</p>
				) : canFollowUp ? (
					<p>
						{state?.pullRequestWatch?.paused
							? "PR follow-up paused."
							: state?.phase === "blocked"
								? "PR follow-up needs attention. Resuming keeps the existing repair budget."
								: "You decide when to merge the PR."}
					</p>
				) : showApprove ? (
					<p>
						Approving lets agents use tools and run these checks on your machine
						in an isolated Git worktree, which is not a security sandbox.
					</p>
				) : handsOff && dirty ? (
					<p>Saving changes to the plan restarts scoping.</p>
				) : null}
			</div>
			<div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
				{canFollowUp ? (
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
				) : null}
				{showSaveBrief ? (
					<Button
						variant="outline"
						disabled={
							busy ||
							!dirty ||
							!instructions.trim() ||
							(editingPlan && factoryChecksBlockSave(config.checks))
						}
						onClick={() => void perform(savePlan)}
					>
						{editingPlan ? FACTORY_RECOVERY.savePlan : "Save brief"}
					</Button>
				) : null}
				{showApprove ? (
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
								// Approval queues execution in the Hub.
								setDraftRevision(approved.revision);
							})
						}
					>
						{designActive ? "Preparing plan…" : "Approve and run"}
					</Button>
				) : null}
			</div>
		</div>
	) : null;

	const panelShown = panelTab !== null;
	const panelProps = panelTab
		? {
				tab: panelTab,
				onTabChange: (tab: FactoryPanelTab) => {
					setPanelTab(tab);
					setMergedOnPanel(true);
				},
				panes,
				actions: panelActions,
				onEscape: focusMain,
			}
		: undefined;
	/**
	 * The card. From 700px of card width (FACTORY_NARROW_CARD) it has two
	 * columns: a 300px main column (360px from 1000px) beside the artifact
	 * panel. Both are exactly as tall as the page's visible area, so only they
	 * scroll and the page does not: the window minus the title bar
	 * (--window-title-bar-height, from WindowTitleBar) and PageFrame's 2.5rem
	 * top and bottom padding (5rem). The card's `fit` PageFrame pads by its
	 * own width: py-10 from 720px of frame width, py-5 below. A card of 700px
	 * or more needs a frame of at least 764px (px-8), so two columns always
	 * sit in the py-10 frame and 5rem is exact. Narrower, the card is one column and the
	 * panel follows the status, before the plan. `merged` puts it inside the
	 * main column, its tabs joined with the card's section tabs.
	 */
	const frame = (lead: ReactNode, rest: ReactNode, merged = false) => {
		const split = panelShown && !merged;
		// Measured narrower than two columns. Unmeasured cards keep the CSS
		// switch, which uses the same width.
		const stacked = split && narrow;
		const panel =
			split && panelProps ? (
				<FactoryArtifactPanel
					{...panelProps}
					className={
						stacked
							? "h-[min(70vh,48rem)]"
							: "h-[min(70vh,48rem)] @min-[700px]:sticky @min-[700px]:top-0 @min-[700px]:h-[calc(100dvh_-_var(--window-title-bar-height)_-_5rem)] @min-[700px]:overscroll-contain"
					}
				/>
			) : null;
		return (
			<div
				ref={cardRef}
				className="@container"
				data-testid="factory-card"
				data-layout={!split ? "single" : stacked ? "stacked" : "two-column"}
			>
				<div
					className={cn(
						"flex flex-col gap-5",
						split &&
							!stacked &&
							"@min-[700px]:grid @min-[700px]:grid-cols-[300px_minmax(0,1fr)] @min-[700px]:items-start @min-[700px]:gap-4 @min-[1000px]:grid-cols-[360px_minmax(0,1fr)] @min-[1000px]:gap-6",
					)}
				>
					<div
						ref={mainRef}
						tabIndex={-1}
						data-testid="factory-card-main"
						className={cn(
							"flex min-w-0 flex-col gap-5 outline-none",
							split &&
								!stacked &&
								"@min-[700px]:sticky @min-[700px]:top-0 @min-[700px]:h-[calc(100dvh_-_var(--window-title-bar-height)_-_5rem)] @min-[700px]:gap-4 @min-[700px]:overflow-x-hidden @min-[700px]:overflow-y-auto @min-[700px]:overscroll-contain @min-[700px]:pr-2",
						)}
					>
						{lead}
						{stacked ? panel : null}
						{rest}
					</div>
					{stacked ? null : panel}
				</div>
			</div>
		);
	};

	// The status and anything that needs the user lead the card; on one
	// column the artifact panel follows them, before the plan.
	const lead = (
		<>
			{header}
			{leaveDialog}
			{alertBlock}
			{failureBlock}
			{questionBlock}
			{conclusionBlock}
			{deliveredBlock}
		</>
	);
	if (handsOff)
		return frame(
			lead,
			<>
				<Panel
					aria-label="What's being built"
					title={
						<>
							What's being built
							{dirty ? (
								<span className="ml-2 font-normal text-amber-600 dark:text-amber-400">
									· Unsaved changes
								</span>
							) : null}
						</>
					}
					actions={
						editingPlan ? (
							<Button
								size="sm"
								variant="ghost"
								disabled={busy}
								onClick={discardPlanEdits}
							>
								Cancel editing
							</Button>
						) : (
							designActionButton
						)
					}
				>
					{replayNote}
					{editingPlan ? (
						<p className="rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
							Editing the plan restarts scoping when you save it.
						</p>
					) : rescopeSavedRevision === task.revision ? (
						<output className="block rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
							{FACTORY_RECOVERY.savedRescoping}
						</output>
					) : null}
					{briefEditor}
					{editingPlan ? (
						<div className="space-y-2 border-t pt-3">
							<FactoryChecksEditor
								config={config}
								setConfig={setConfig}
								disabled={!briefEditable || busy}
								workspaceRoot={task.workspaceRoot}
							/>
						</div>
					) : null}
					{/* A delivered card's proof receipt lists each requirement. */}
					{deliveredBlock ? null : (
						<div className="space-y-2 border-t pt-3">
							{/* Results carry their own "Acceptance criteria" heading. */}
							{criteriaHasHeading ? null : (
								<h4 className="text-xs font-medium text-muted-foreground">
									Acceptance criteria
								</h4>
							)}
							{criteriaBlock}
						</div>
					)}
				</Panel>
				{replay ? comparisonTool : null}
				{details(
					<>
						{baseNote}
						{costLine}
						{task.modelSelection ? (
							<p className="text-xs text-muted-foreground">
								Model: {task.modelSelection.providerId}/
								{task.modelSelection.modelId ?? "default"}
							</p>
						) : null}
						<FactoryVerificationSetup
							config={config}
							dryRun={matchesTask ? state?.verificationProfile : undefined}
							hasVerifier={hasVerifier}
						/>
						{reviewTeam}
						{planReview}
						{replay ? null : comparisonTool}
						{configuration}
					</>,
				)}
				{footer}
			</>,
		);
	const sections: FactoryPanelSection[] = [
		{
			value: "plan",
			label: "Plan",
			icon: FileText,
			content: (
				<>
					<Panel
						title={
							<>
								Brief
								{dirty ? (
									<span className="ml-2 font-normal text-amber-600 dark:text-amber-400">
										· Unsaved draft
									</span>
								) : null}
							</>
						}
						actions={
							<>
								<Button
									size="sm"
									variant="ghost"
									disabled={!briefEditable}
									onClick={() => setEditing((value) => !value)}
								>
									{editing ? (
										<Eye className="mr-1.5 size-3.5" />
									) : (
										<Pencil className="mr-1.5 size-3.5" />
									)}
									{editing ? "Preview" : "Edit"}
								</Button>
								{designActionButton}
							</>
						}
					>
						{replayNote}
						{briefEditor}
						<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t pt-3">
							{replay ? (
								<span />
							) : (
								<details className="min-w-0 text-xs text-muted-foreground">
									<summary className="cursor-pointer select-none">
										How scoping and approval work
									</summary>
									<p className="mt-2 max-w-prose leading-5">
										To refine a saved plan, edit the brief or reference docs,
										then choose Refine design. The agent reads your request,
										docs and repository, then asks about unresolved requirements
										here. The agreed brief and checks are saved for your
										approval. Approval authorizes agent tools and these check
										commands on your machine, using an isolated Git worktree.
										The worktree is not a security sandbox.
									</p>
								</details>
							)}
							{designSession ? (
								<Button
									size="sm"
									variant="link"
									className="h-auto p-0 text-xs"
									onClick={() =>
										void openSession(designSession).catch(() => undefined)
									}
								>
									View design transcript{" "}
									<ArrowUpRight className="ml-1 size-3" />
								</Button>
							) : null}
						</div>
					</Panel>
					<Panel
						aria-label="Acceptance criteria"
						title="Acceptance criteria"
						description="What must be true for this work to count as done, and what proves it."
					>
						{config.acceptanceCriteria?.length ? (
							<AcceptanceCriteria
								items={config.acceptanceCriteria.map((criterion) => ({
									criterion,
								}))}
							/>
						) : (
							<p className="text-xs text-muted-foreground">
								No acceptance criteria are recorded for this plan.
							</p>
						)}
					</Panel>
					{reviewTeam}
					{planReview}
					{configuration}
					{config.verificationProfile ? (
						<Panel>
							<FactoryVerificationSetup
								config={config}
								dryRun={matchesTask ? state?.verificationProfile : undefined}
								hasVerifier={hasVerifier}
							/>
						</Panel>
					) : null}
				</>
			),
		},
	];
	// Before a run there is nothing to verify; a replay shows its comparison.
	const verificationShown = Boolean(
		state || task.currentRunId || task.lastRunId || replay,
	);
	const shownPage = verificationShown ? page : "plan";
	if (verificationShown)
		sections.push({
			value: "verification",
			label: "Verification",
			icon: CheckCircle2,
			content: (
				<>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="min-w-0 text-sm">
							{state ? (
								<h3 className="font-semibold">
									{FACTORY_CARD.resultsHeading}
									<span className="font-normal text-muted-foreground">
										{evidenceNote}
									</span>
								</h3>
							) : runsLoading ? (
								<p className="text-muted-foreground">Loading verification…</p>
							) : !evidenceError ? (
								<p className="text-muted-foreground">
									No verification has been recorded yet.
								</p>
							) : null}
						</div>
					</div>
					{state ? (
						<>
							<AcceptanceResults
								criteria={state.inputSnapshot?.factory.acceptanceCriteria}
								candidate={state.candidate}
							/>
							{baseNote}
							{costLine}
						</>
					) : null}
					{replay ? comparisonTool : null}
				</>
			),
		});
	const merged = narrow && panelProps !== undefined;
	return frame(
		lead,
		<>
			{merged && panelProps ? (
				<FactoryArtifactPanel
					{...panelProps}
					sections={sections}
					section={mergedOnPanel ? undefined : shownPage}
					onSectionChange={(value) => {
						if (value === "plan" || value === "verification") setPage(value);
						setMergedOnPanel(false);
					}}
				/>
			) : (
				<Tabs value={shownPage} onValueChange={setPage} className="gap-5">
					{/* One section needs no tab. */}
					{sections.length > 1 ? (
						<TabsList aria-label="Task sections" className="max-w-full">
							{sections.map(({ value, label, icon: Icon }) => (
								<TabsTrigger key={value} value={value}>
									{Icon ? <Icon className="size-3.5" /> : null}
									{label}
								</TabsTrigger>
							))}
						</TabsList>
					) : null}
					{sections.map((section) => (
						<TabsContent
							key={section.value}
							value={section.value}
							className="space-y-5"
						>
							{section.content}
						</TabsContent>
					))}
				</Tabs>
			)}
			{/* Stays mounted across evidence refreshes; it reloads only on demand. */}
			{details(replay ? null : comparisonTool)}
			{footer}
		</>,
		merged,
	);
}

/** Lowercase letters and digits only, for comparing headings. */
const headingKey = (text: string) =>
	text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * The brief as shown on its card: a leading Markdown heading that repeats
 * the card's title is dropped. The saved brief is unchanged.
 */
export function factoryBriefWithoutTitle(brief: string, title: string): string {
	const match = /^\s*#{1,2}[ \t]+(.+?)[ \t#]*(?:\r?\n|$)/.exec(brief);
	if (!match?.[1] || headingKey(match[1]) !== headingKey(title)) return brief;
	return brief.slice(match[0].length).replace(/^\s*\n/, "");
}

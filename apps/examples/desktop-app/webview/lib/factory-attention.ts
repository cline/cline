import type {
	AgendaTaskRecord,
	AgendaTaskRunStatus,
	FactoryCardRunStateFacts,
	FactoryCardStage,
	FactoryCardState,
	FactoryCardStateInput,
	FactoryCardTaskFacts,
	FactoryDesignConclusion,
	FactoryPlanApprovalInput,
	FactoryRunState,
} from "@cline/shared";
import {
	FACTORY_AUTO_APPROVAL_WAITING_PREFIX,
	FACTORY_CARD_STAGES,
	FACTORY_PLAN_FAULT_PREFIX,
	FACTORY_PLAN_FAULT_STOPPED_PREFIX,
	FACTORY_UNRESOLVED_FINDINGS_REVIEW,
	factoryActiveStage,
	factoryCardState,
	factoryCheckConfigurationFindings,
	factoryPlanApprovalBlocker,
	factoryRepositoryRelative,
	factoryStageName,
	isFactoryHandsOff,
} from "@cline/shared/browser";
import { factoryPlanReady } from "./factory-approval";
import { FACTORY_RULE_CARD } from "./factory-copy";

/** The run fields that decide attention, as task events and run reads carry them. */
type FactoryAttentionRun = {
	runId: string;
	taskRevision: number;
	factory?: {
		phase: string;
		humanApproval?: unknown;
		audit?: { finding?: string };
		candidate?: { commit: string };
		pullRequestWatch?: { pending?: unknown; paused?: boolean };
		pullRequestChecks?: { status: string; headCommit: string };
		pullRequestUrl?: string;
		autoRecovery?: FactoryAutoRecovery;
		humanReview?: FactoryHumanReview;
		unresolvedFindings?: FactoryUnresolvedFindings;
	};
};
/** Findings no repair cleared when a run stopped at its repair limit. */
type FactoryUnresolvedFindings = {
	commit: string;
	findings: string[];
	pullRequestOpen?: boolean;
};
/** Whether core asked for the user's review at delivery, and why. */
export type FactoryHumanReview = { required: boolean; reason: string };
type FactoryAutoRecovery = { attempts: number; reason: string; at: string };
type FactoryAttentionState = NonNullable<FactoryAttentionRun["factory"]>;

/**
 * Why a Factory task needs the user, most urgent first. A run contributes at
 * most one reason, so one stop is never reported as several. The board's
 * "Needs you" column and native notifications both derive from this.
 */
export type FactoryAttentionReason<Question> =
	| { kind: "question"; question: Question }
	/** `breakdown`: scoping split the request into parts for the person to approve. */
	| { kind: "rule" | "stopped" | "paused" | "breakdown" }
	/** `blocker` is set when an automatic approval was refused and why. */
	| { kind: "plan"; blocker?: string }
	| { kind: "triage"; outcome: FactoryDesignConclusion["outcome"] }
	/**
	 * `humanReview` is what core froze at delivery; legacy runs lack it and
	 * read as before (a review for manual work, feedback for hands-off work).
	 * `unresolvedFindings` counts the review findings an open draft PR still
	 * has after the run stopped at its repair limit.
	 */
	| {
			kind: "ready";
			commit?: string;
			pullRequestUrl?: string;
			humanReview?: FactoryHumanReview;
			unresolvedFindings?: number;
	  };

/** Hands-off runs retry a failure automatically at most this many times. */
export const FACTORY_AUTO_RETRY_LIMIT = 1;

/** The run fields that tell the automatic retry from a later manual one. */
export type FactoryRetryRun = {
	runId: string;
	taskRevision: number;
	createdAt?: string;
	status?: string;
};

const TERMINAL_RUN_STATUSES = new Set([
	"completed",
	"failed",
	"cancelled",
	"interrupted",
]);

/**
 * A hands-off run whose one automatic retry is queued or running. The failure
 * it recovers from is not the user's to resolve yet. A failure recorded after
 * the retry was scheduled is the retry's own, and is reported as usual.
 *
 * Later runs on the same revision inherit `autoRecovery`, so with the card's
 * runs a manual Try again after the retry failed is not mistaken for it: only
 * the first run created after the retry was scheduled is the retry, and only
 * while it has not finished (or before it exists).
 */
export function factoryAutoRetrying(
	task: {
		status: string;
		error?: string;
		updatedAt?: string;
		revision?: number;
		currentRunId?: string;
		lastRunId?: string;
	},
	state: { autoRecovery?: FactoryAutoRecovery } | undefined,
	runs?: readonly FactoryRetryRun[],
): boolean {
	const recovery = state?.autoRecovery;
	if (!recovery || recovery.attempts < 1) return false;
	// Without run times (an older reply) the retry cannot be told apart.
	const timed = runs?.every((run) => run.createdAt) ? runs : undefined;
	const scheduledAt = Date.parse(recovery.at);
	const after = timed?.filter(
		(run) =>
			(task.revision === undefined || run.taskRevision === task.revision) &&
			Date.parse(run.createdAt ?? "") > scheduledAt,
	);
	if (task.status === "approved" || task.status === "in_progress") {
		if (!after || after.length === 0) return true;
		const current = timed?.find(
			(run) => run.runId === (task.currentRunId ?? task.lastRunId),
		);
		return (
			after.length === 1 &&
			current?.runId === after[0]?.runId &&
			!TERMINAL_RUN_STATUSES.has(current.status ?? "")
		);
	}
	// A run started after the retry was scheduled has already finished.
	if (after?.some((run) => TERMINAL_RUN_STATUSES.has(run.status ?? "")))
		return false;
	if (task.status !== "failed" && !task.error) return false;
	const failedAt = task.updatedAt ? Date.parse(task.updatedAt) : Number.NaN;
	return failedAt <= Date.parse(recovery.at);
}

/** Board copy for a run that is retrying after a failure. */
export function factoryAutoRetryLabel(
	recovery: Pick<FactoryAutoRecovery, "attempts"> | undefined,
): string {
	const attempts = Math.min(
		Math.max(recovery?.attempts ?? 1, 1),
		FACTORY_AUTO_RETRY_LIMIT,
	);
	return `Retrying after failure (${attempts}/${FACTORY_AUTO_RETRY_LIMIT})`;
}

/**
 * The reason core recorded when automatic approval refused a settled plan.
 * It is a plan waiting for approval, not a failure.
 */
export function factoryAutoApprovalWaiting(task: {
	status: string;
	error?: string;
}): string | null {
	if (
		task.status !== "pending_approval" ||
		!task.error?.startsWith(FACTORY_AUTO_APPROVAL_WAITING_PREFIX)
	)
		return null;
	return task.error.slice(FACTORY_AUTO_APPROVAL_WAITING_PREFIX.length).trim();
}

/**
 * Why an automatic plan approval was refused: the plan settled but cannot be
 * approved, so it waits for the user instead of running. Core's recorded
 * reason wins; it covers checks the client cannot repeat, such as agent
 * availability.
 */
export function factoryAutoApprovalBlocker(
	task: FactoryPlanApprovalInput & { status: string; error?: string },
): string | null {
	const recorded = factoryAutoApprovalWaiting(task);
	if (recorded !== null)
		return recorded || "Automatic approval is waiting for you.";
	const design =
		task.factoryDesignProgress?.revision === task.revision
			? task.factoryDesignProgress
			: undefined;
	if (
		task.status !== "pending_approval" ||
		task.factory.approval !== "automatic" ||
		design?.phase !== "complete" ||
		design.conclusion
	)
		return null;
	return factoryPlanApprovalBlocker(task);
}

/** The designer's no-build conclusion for the task's current brief, if any. */
export function currentFactoryConclusion(
	task: Pick<FactoryPlanApprovalInput, "revision" | "factoryDesignProgress">,
): FactoryDesignConclusion | undefined {
	return task.factoryDesignProgress?.revision === task.revision
		? task.factoryDesignProgress.conclusion
		: undefined;
}

/** The run state describing the task's current revision, if `run` is that run. */
export function currentFactoryRunState<Run extends FactoryAttentionRun>(
	task: Pick<AgendaTaskRecord, "revision" | "currentRunId" | "lastRunId">,
	run: Run | undefined,
): Run["factory"] | undefined {
	return run &&
		run.runId === (task.currentRunId ?? task.lastRunId) &&
		run.taskRevision === task.revision
		? run.factory
		: undefined;
}

/**
 * A run that stopped at its repair limit after its draft PR opened on the
 * same candidate. The PR is the result, waiting for a person with these
 * findings; it is not a failure. Paths read repository-relative.
 */
export function factoryOpenFindings(
	task: { status: string; archivedAt?: string },
	state:
		| {
				phase: string;
				pullRequestUrl?: string;
				unresolvedFindings?: FactoryUnresolvedFindings;
		  }
		| undefined,
): { pullRequestUrl: string; findings: string[] } | undefined {
	const open = state?.unresolvedFindings;
	if (
		task.archivedAt ||
		task.status !== "failed" ||
		state?.phase !== "blocked" ||
		!state.pullRequestUrl ||
		!open?.pullRequestOpen
	)
		return undefined;
	return {
		pullRequestUrl: state.pullRequestUrl,
		findings: open.findings.map((finding) =>
			factoryRepositoryRelative(finding),
		),
	};
}

/** The task fields attention reads, as task events and task reads carry them. */
type FactoryAttentionTask<Question> = FactoryPlanApprovalInput & {
	status: string;
	archivedAt?: string;
	error?: string;
	updatedAt?: string;
	currentRunId?: string;
	lastRunId?: string;
	factoryQueued?: AgendaTaskRecord["factoryQueued"];
	factoryQuestions?: Question[];
};

/**
 * A split's link facts the host computed from the cards it holds: a parent's
 * parts' progress and a waiting part's dependency state (the sidecar's
 * attention sweep; `factoryCardState` reads both).
 */
export type FactoryCardLinks = Pick<
	FactoryCardStateInput,
	"parts" | "dependency"
>;

/** Where the card stands, from what attention reads. */
export function factoryAttentionCard(
	task: FactoryAttentionTask<unknown>,
	state: FactoryAttentionState | undefined,
	runs?: readonly FactoryRetryRun[],
	links?: FactoryCardLinks,
): FactoryCardState {
	const current = runs?.find(
		(run) => run.runId === (task.currentRunId ?? task.lastRunId),
	);
	return factoryCardState({
		// Task events and task reads carry the stored record.
		task: task as FactoryCardTaskFacts,
		planApprovable: factoryPlanReady(task),
		...(state
			? {
					lastRun: {
						status: (current?.status ?? "running") as AgendaTaskRunStatus,
						createdAt: current?.createdAt,
						factory: state as FactoryCardRunStateFacts,
					},
				}
			: {}),
		...links,
	});
}

export function factoryAttentionReasons<
	Question extends { status: string; revision: number },
>(
	task: FactoryAttentionTask<Question>,
	state: FactoryAttentionState | undefined,
	runs?: readonly FactoryRetryRun[],
	links?: FactoryCardLinks,
): FactoryAttentionReason<Question>[] {
	if (
		task.archivedAt ||
		task.status === "cancelled" ||
		task.status === "expired"
	)
		return [];
	const reasons = (task.factoryQuestions ?? [])
		.filter(
			(question) =>
				question.status === "pending" && question.revision === task.revision,
		)
		.map(
			(question): FactoryAttentionReason<Question> => ({
				kind: "question",
				question,
			}),
		);
	// Where the card stands and whether it waits on the person come from
	// factoryCardState; the reasons below only add what each surface shows.
	const card = factoryAttentionCard(task, state, runs, links);
	const openFindings = factoryOpenFindings(task, state);
	// A note on a delivery is not a decision; a rule proposed from it is.
	if (card.reasonCode === "rule_proposed") reasons.push({ kind: "rule" });
	else if (card.reasonCode === "split_approval")
		reasons.push({ kind: "breakdown" });
	else if (openFindings) {
		// The draft PR is ready for a person until they mark it reviewed.
		if (card.waitingOn === "person")
			reasons.push({
				kind: "ready",
				commit: state?.unresolvedFindings?.commit,
				pullRequestUrl: openFindings.pullRequestUrl,
				humanReview: state?.humanReview ?? {
					required: true,
					reason: FACTORY_UNRESOLVED_FINDINGS_REVIEW,
				},
				unresolvedFindings: openFindings.findings.length,
			});
	} else if (factoryAutoRetrying(task, state, runs)) {
		// The retry decides whether this needs the user.
	} else if (card.kind === "stopped") reasons.push({ kind: "stopped" });
	else if (card.reasonCode === "followup_paused")
		reasons.push({ kind: "paused" });
	// A review draft is the person's to post or leave: nothing waits on it.
	else if (
		state &&
		card.deliverable?.kind !== "review" &&
		card.kind === "delivered" &&
		task.status === "completed" &&
		!state.humanApproval &&
		card.reasonCode !== "pr_merged" &&
		card.reasonCode !== "pr_closed" &&
		(state.phase === "ready" ||
			(state.phase === "watching" &&
				!state.pullRequestWatch?.pending &&
				state.pullRequestChecks?.status === "passed" &&
				state.pullRequestChecks.headCommit === state.candidate?.commit))
	)
		// A result to look at; it needs the person only with a required stamp.
		reasons.push({
			kind: "ready",
			commit: state.candidate?.commit,
			...(state.pullRequestUrl ? { pullRequestUrl: state.pullRequestUrl } : {}),
			...(state.humanReview ? { humanReview: state.humanReview } : {}),
		});
	// A conclusion blocks approval, so it never co-occurs with "plan". It needs
	// confirmation in every status and approval mode: nothing closes the card
	// for you, and a concluded card is never queued.
	// A pending question means scoping has not settled the plan yet, so the
	// plan is not offered for approval beside it.
	const conclusion = currentFactoryConclusion(task);
	if (conclusion) reasons.push({ kind: "triage", outcome: conclusion.outcome });
	else if (
		card.kind === "awaiting_approval" &&
		card.waitingOn === "person" &&
		card.reasonCode !== "split_approval"
	) {
		// Why it cannot be approved as it is, when it cannot.
		const blocker =
			factoryAutoApprovalBlocker(task) ?? factoryPlanApprovalBlocker(task);
		reasons.push({ kind: "plan", ...(blocker ? { blocker } : {}) });
	}
	return reasons;
}

/**
 * A stopped card whose plan is at fault: its checks cannot run as written,
 * its last run stopped on a check its own setup blocked, or core recorded a
 * plan fault. Trying it again restarts scoping instead of re-running it.
 * Not a card Factory already re-scoped without fixing its checks: see
 * `factoryPlanFaultStopped`.
 */
export function factoryPlanFault(
	task: Pick<
		AgendaTaskRecord,
		"status" | "error" | "factory" | "workspaceRoot"
	>,
	state?: {
		candidate?: {
			checks: readonly { status: string; blockedBy?: string }[];
		};
	},
): boolean {
	if (
		task.status !== "failed" ||
		!task.factory ||
		factoryPlanFaultStopped(task)
	)
		return false;
	return (
		Boolean(task.error?.startsWith(FACTORY_PLAN_FAULT_PREFIX)) ||
		Boolean(
			state?.candidate?.checks.some(
				(check) =>
					check.status !== "passed" && check.blockedBy === "configuration",
			),
		) ||
		factoryCheckConfigurationFindings(task.factory.checks, task.workspaceRoot)
			.length > 0
	);
}

/**
 * Factory already sent this card back to scoping once and its checks still
 * cannot work: scoping again will not fix them, so the user edits the plan.
 */
export function factoryPlanFaultStopped(
	task: Pick<AgendaTaskRecord, "status" | "error">,
): boolean {
	return (
		task.status === "failed" &&
		Boolean(task.error?.startsWith(FACTORY_PLAN_FAULT_STOPPED_PREFIX))
	);
}

/**
 * How Try again moves a failed card on: `scope` restarts scoping (a plan
 * fault, or no approvable plan), `queue` hands the still-approved plan back
 * to the Factory queue, which decides whether to re-run or re-scope it, and
 * `approve` approves an edited, approvable plan.
 */
export function factoryRetryPath(
	task: Pick<
		AgendaTaskRecord,
		| "status"
		| "error"
		| "factory"
		| "workspaceRoot"
		| "approvedRevision"
		| "revision"
	>,
	options: {
		state?: Parameters<typeof factoryPlanFault>[1];
		/** The card's current revision has a complete plan approval accepts. */
		approvable?: boolean;
	} = {},
): "scope" | "queue" | "approve" {
	if (factoryPlanFault(task, options.state)) return "scope";
	if (task.approvedRevision === task.revision) return "queue";
	return options.approvable ? "approve" : "scope";
}

/**
 * The workflow's stop at its review repair limit: "Repair limit (2)
 * reached[; …].\n- finding\n- finding" (factory-workflow.ts).
 */
const REPAIR_LIMIT_STOP = /^Repair limit \((\d+)\) reached\b/;

/**
 * Why a run stopped at its review repair limit, with the first finding it
 * could not clear: "Review still found a problem after 1 fix round: …".
 * Undefined for any other error.
 */
export function factoryRepairLimitReason(
	text: string | undefined,
): string | undefined {
	const trimmed = text?.trim() ?? "";
	const limit = REPAIR_LIMIT_STOP.exec(trimmed);
	if (!limit) return undefined;
	const rounds = Number(limit[1]);
	const after = `after ${rounds} fix ${rounds === 1 ? "round" : "rounds"}`;
	const finding = /^\s*-\s+(.+)$/m.exec(trimmed)?.[1]?.trim();
	return finding
		? `Review still found a problem ${after}: ${finding}`
		: `Review still found problems ${after}.`;
}

/**
 * `FACTORY_PUBLISH_FAILURE_PREFIX` ("Could not open the draft PR: "), or an
 * older run's "Could not confirm the draft PR…".
 */
const PUBLISH_FAILURE =
	/^Could not (?:open|confirm) the draft PR\b[^:.]*[:.]?\s*/;

/**
 * The one-sentence reason behind a draft PR that could not be opened, from
 * `pullRequestError` or a task or run error ("Could not open the draft PR: …";
 * older runs say "Could not confirm the draft PR…"). Undefined for other
 * errors; empty when the error gives no reason.
 */
export function factoryPublishFailureReason(
	text: string | undefined,
): string | undefined {
	const trimmed = text?.trim();
	if (!trimmed) return undefined;
	const match = PUBLISH_FAILURE.exec(trimmed);
	if (!match) return undefined;
	const rest = trimmed.slice(match[0].length).split("\n")[0]?.trim() ?? "";
	return /^(.+?[.!?])(?:\s|$)/.exec(rest)?.[1] ?? rest;
}

/**
 * Where a card stands before scoping starts: `held` when it was explicitly
 * put on hold, `queued` when the Hub reports it in the design queue
 * (`factoryQueued`). A card in neither is not going to start on its own. A
 * live design session is neither: it is scoping.
 */
export function factoryScopingWait(
	task: Pick<
		AgendaTaskRecord,
		| "status"
		| "archivedAt"
		| "error"
		| "factory"
		| "factoryQueued"
		| "factoryDesignProgress"
		| "revision"
	>,
): "held" | "queued" | undefined {
	if (task.status !== "pending_approval" || task.archivedAt || task.error)
		return undefined;
	if (
		task.factoryDesignProgress?.revision === task.revision &&
		task.factoryDesignProgress.phase !== "complete"
	)
		return undefined;
	if (task.factory?.hold === true) return "held";
	return task.factoryQueued === "design" ? "queued" : undefined;
}

/**
 * Whether a delivered result waits for the user to mark it as reviewed. Core
 * freezes the answer at delivery; runs from before that keep the old rule:
 * manual work needs review, hands-off work does not.
 */
export function factoryReviewRequired(
	task: { factory?: { autonomy?: unknown } },
	state: { humanReview?: FactoryHumanReview } | undefined,
): boolean {
	return state?.humanReview
		? state.humanReview.required
		: !isFactoryHandsOff(task.factory);
}

/** A card Factory filed for a pattern reviewers found in several cards. */
export function isFactoryRuleCard(task: {
	factory?: { intake?: { source?: string } };
}): boolean {
	return task.factory?.intake?.source === FACTORY_RULE_CARD.source;
}

/**
 * Creating or restoring a replay queues its plan review, and the review records
 * progress once it starts. Replays without plan reviewers record a complete
 * design when created, so they never match.
 */
export function isReplayReviewQueued(task: AgendaTaskRecord): boolean {
	return (
		Boolean(task.factory?.replay) &&
		!task.archivedAt &&
		!task.error &&
		task.status === "pending_approval" &&
		task.factoryDesignProgress?.revision !== task.revision
	);
}

/** The dry run of a card's verification setup, as the sidecar projects it. */
export type FactoryVerificationPreflight = {
	hash: string;
	preflight: "passed" | "failed";
	stage?: string;
};

/** Details the sidecar adds to a Factory attention outcome. */
export type FactoryOutcomeDetails = {
	pullRequestUrl?: string;
	autoRecovery?: FactoryAutoRecovery;
	/** The run failed and its one automatic retry is queued or running. */
	autoRetrying?: boolean;
	/** Core's frozen answer to "does this result need the user's review?". */
	humanReview?: FactoryHumanReview;
	verificationProfile?: FactoryVerificationPreflight;
};

/** Reads the optional details from an attention outcome sent over IPC. */
export function factoryOutcomeDetails(
	outcome: object | undefined,
): FactoryOutcomeDetails {
	if (!outcome) return {};
	const value = outcome as Record<string, unknown>;
	const recovery = value.autoRecovery as Record<string, unknown> | undefined;
	return {
		...(typeof value.pullRequestUrl === "string" && value.pullRequestUrl
			? { pullRequestUrl: value.pullRequestUrl }
			: {}),
		...(isHumanReview(value.humanReview)
			? {
					humanReview: {
						required: value.humanReview.required,
						reason: value.humanReview.reason,
					},
				}
			: {}),
		...(isPreflight(value.verificationProfile)
			? {
					verificationProfile: {
						hash: value.verificationProfile.hash,
						preflight: value.verificationProfile.preflight,
						...(typeof value.verificationProfile.stage === "string"
							? { stage: value.verificationProfile.stage }
							: {}),
					},
				}
			: {}),
		...(recovery &&
		typeof recovery.attempts === "number" &&
		typeof recovery.reason === "string" &&
		typeof recovery.at === "string"
			? {
					autoRecovery: {
						attempts: recovery.attempts,
						reason: recovery.reason,
						at: recovery.at,
					},
					autoRetrying: value.autoRetrying === true,
				}
			: {}),
	};
}

function isHumanReview(value: unknown): value is FactoryHumanReview {
	const review = value as Record<string, unknown> | null | undefined;
	return (
		typeof review === "object" &&
		review !== null &&
		typeof review.required === "boolean" &&
		typeof review.reason === "string"
	);
}

function isPreflight(
	value: unknown,
): value is FactoryVerificationPreflight & { stage?: unknown } {
	const profile = value as Record<string, unknown> | null | undefined;
	return (
		typeof profile === "object" &&
		profile !== null &&
		typeof profile.hash === "string" &&
		(profile.preflight === "passed" || profile.preflight === "failed")
	);
}

/**
 * Why the sidecar could not read a card's stored data, when it could not.
 * It reports such a card as one item with `unreadable` instead of failing
 * every card.
 */
export function factoryUnreadable(attention: unknown): string | undefined {
	if (!attention || typeof attention !== "object") return undefined;
	const unreadable = (attention as { unreadable?: unknown }).unreadable;
	if (!unreadable || typeof unreadable !== "object") return undefined;
	const reason = (unreadable as { reason?: unknown }).reason;
	return typeof reason === "string" ? reason : "";
}

/**
 * Where a card can be, in order. Every surface that says where a card is (the
 * home's rows, the card's header, the rail and the sidebar) uses these and
 * `factoryStation`, so a card is in one place everywhere. `waiting` is a
 * state, not a stage: the stage line shows the other five. The plan's
 * deterministic checks are part of Build. Shared with core's status tool
 * through `factoryCardState`.
 */
export const FACTORY_STATIONS = FACTORY_CARD_STAGES;
export type FactoryStation = FactoryCardStage;

/**
 * The run fields `factoryStation` reads. Both the board's attention outcome
 * and a card's own run state fit; `activeRoles` or `activeSessions` say which
 * agents are running (a run state's running attempts, for example).
 */
export type FactoryStationOutcome = Partial<
	Omit<FactoryCardRunStateFacts, "phase">
> & {
	phase?: FactoryCardRunStateFacts["phase"];
	activeSessions?: readonly { role: string }[];
	/** The sidecar's answer: the run failed and its one automatic retry is queued or running. */
	autoRetrying?: boolean;
	/** The repository stage running now, as the sidecar names it (factoryActiveStage). */
	activeStage?: string;
};

/** Where a card is on the line. */
export type FactoryStationState = {
	/** The station the card is at, or where it stopped. */
	station: FactoryStation;
	/** The card stopped at `station` and waits for Try again or a fix. */
	stopped: boolean;
	/** Stations this card's plan does not use (Verify without a tester). */
	skipped: FactoryStation[];
	/** At Build because the plan's checks are running, or stopped them. */
	checks?: boolean;
	/** The repository stage running now, a sub-step of Build ("Build · <stage>"). */
	stage?: string;
	/** At `delivered`, and delivered on `now`'s local calendar day. */
	deliveredToday: boolean;
};

type FactoryStationTask = FactoryCardTaskFacts &
	Partial<Pick<AgendaTaskRecord, "updatedAt" | "instructions">>;

/**
 * `factoryCardState`'s input from what the desktop has: the task and the
 * board's outcome (or the card's own run state). The board does not know
 * which sessions are live, so a scoping session in progress counts as live.
 */
export function factoryCardInput(
	task: FactoryCardTaskFacts & Partial<Pick<AgendaTaskRecord, "instructions">>,
	outcome: FactoryStationOutcome | undefined,
	links?: FactoryCardLinks,
): FactoryCardStateInput {
	const design =
		task.factoryDesignProgress?.revision === task.revision
			? task.factoryDesignProgress
			: undefined;
	const {
		phase,
		activeSessions,
		autoRetrying,
		activeStage: _stage,
		...facts
	} = outcome ?? {};
	return {
		task,
		...(phase
			? {
					lastRun: {
						// Only an automatic retry reads the run's status here.
						status: autoRetrying ? "failed" : "running",
						factory: {
							...facts,
							phase,
							activeRoles: [
								...(facts.activeRoles ?? []),
								...(activeSessions ?? []).map((session) => session.role),
							],
						},
					},
				}
			: {}),
		live: { designLive: Boolean(design && design.phase !== "complete") },
		...(hasPlanApprovalInput(task)
			? { planApprovable: factoryPlanReady(task) }
			: {}),
		...links,
	};
}

/** A full task record, as the board and the card have, not a partial one. */
function hasPlanApprovalInput(
	task: FactoryCardTaskFacts & Partial<Pick<AgendaTaskRecord, "instructions">>,
): task is FactoryCardTaskFacts & FactoryPlanApprovalInput {
	return (
		task.status === "pending_approval" &&
		task.instructions !== undefined &&
		task.factory?.checks !== undefined
	);
}

function sameLocalDay(iso: string | undefined, now: Date): boolean {
	if (!iso) return false;
	const date = new Date(iso);
	return (
		!Number.isNaN(date.getTime()) &&
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate()
	);
}

/**
 * Where a card is on the line, and whether it stopped there, from
 * `factoryCardState`. Archiving does not move a card.
 */
export function factoryStation(
	task: FactoryStationTask,
	outcome: FactoryStationOutcome | undefined,
	{ now = new Date(), links }: { now?: Date; links?: FactoryCardLinks } = {},
): FactoryStationState {
	const card = factoryCardState(
		factoryCardInput({ ...task, archivedAt: undefined }, outcome, links),
	);
	// The automatic retry builds again. Only the card's runs tell it from a
	// stop or an unqueued card (factoryAutoRetrying); the sidecar says so.
	const retrying = Boolean(
		outcome?.autoRetrying &&
			(card.kind === "stopped" || card.stage === "waiting"),
	);
	const station = retrying ? "build" : card.stage;
	const stopped = !retrying && card.kind === "stopped";
	// The board's outcome names the stage; a card's own run state has the
	// results factoryCardState reads.
	const activeStage =
		card.kind === "running" && station === "build"
			? (card.activeStage ?? outcome?.activeStage)
			: undefined;
	return {
		station,
		stopped,
		skipped: card.skipped,
		...(card.checks && !retrying ? { checks: true } : {}),
		...(activeStage && !retrying ? { stage: activeStage } : {}),
		deliveredToday:
			station === "delivered" && !stopped && sameLocalDay(task.updatedAt, now),
	};
}

/** Characters of a run's error the board's outcome carries. */
const FACTORY_OUTCOME_ERROR_CHARS = 1000;

/**
 * The board's outcome for a card's current run, as the sidecar sends it
 * (factory_attention): what the board's card state and line read, without
 * the run's logs, diffs or full attempt history.
 */
export function factoryAttentionOutcome(
	task: Parameters<typeof factoryAutoRetrying>[0],
	state: FactoryRunState,
	runs: readonly FactoryRetryRun[],
) {
	// Running role sessions, so a board row can watch one without reading
	// each card's run again.
	const activeAttempts = (state.attempts ?? []).filter(
		(attempt) => attempt.status === "intent" || attempt.status === "running",
	);
	const activeStage = factoryActiveStage(state);
	return {
		phase: state.phase,
		activeRoles: activeAttempts.map((attempt) => attempt.role),
		activeSessions: activeAttempts.map((attempt) => ({
			sessionId: attempt.sessionId,
			role: attempt.role,
			startedAt: attempt.createdAt,
			// A repository stage's session is named by its stage.
			...(attempt.stageId
				? { stage: factoryStageName(state, attempt.stageId) }
				: {}),
		})),
		followupPaused: state.pullRequestWatch?.paused === true,
		// The repository stage running now, a sub-step of Build.
		...(activeStage ? { activeStage } : {}),
		// Why a run stopped, bounded: a stop after delivery reads as one.
		...(state.error
			? { error: state.error.slice(0, FACTORY_OUTCOME_ERROR_CHARS) }
			: {}),
		...(state.pullRequestUrl ? { pullRequestUrl: state.pullRequestUrl } : {}),
		// What became of the PR, for the delivered card's line.
		...(state.pullRequestOutcome
			? { pullRequestOutcome: state.pullRequestOutcome }
			: {}),
		...(state.pullRequestReady ? { pullRequestReady: true } : {}),
		// Whether a review draft was posted, for the card's place and label.
		...(state.reviewPost ? { reviewPost: state.reviewPost } : {}),
		// The reviewed pull request's title names a review card (factoryCardTitle).
		...(state.reviewPullRequest
			? { reviewPullRequest: state.reviewPullRequest }
			: {}),
		...(state.autoRecovery
			? {
					autoRecovery: state.autoRecovery,
					autoRetrying: factoryAutoRetrying(task, state, runs),
				}
			: {}),
		// Frozen at delivery; absent on runs from before it was.
		...(state.humanReview ? { humanReview: state.humanReview } : {}),
		// A stop at the repair limit, possibly with the draft PR open.
		...(state.unresolvedFindings
			? { unresolvedFindings: state.unresolvedFindings }
			: {}),
		// The dry-run summary only; its log stays on the run.
		...(state.verificationProfile
			? {
					verificationProfile: {
						hash: state.verificationProfile.hash,
						preflight: state.verificationProfile.preflight,
						...(state.verificationProfile.stage
							? { stage: state.verificationProfile.stage }
							: {}),
					},
				}
			: {}),
		humanApproval: state.humanApproval,
		audit: state.audit,
		usage: state.usage,
		repairRound: state.repairRound,
	};
}

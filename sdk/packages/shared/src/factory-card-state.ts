import {
	FACTORY_AUTO_APPROVAL_WAITING_PREFIX,
	FACTORY_PLAN_FAULT_PREFIX,
	FACTORY_PLAN_FAULT_STOPPED_PREFIX,
	FACTORY_PUBLISH_FAILURE_PREFIX,
	FACTORY_SPENDING_LIMIT_PREFIX,
	type FactoryPlanHoldReason,
	type FactoryRunState,
	type FactoryTaskConfig,
	factoryActiveStage,
	factoryCheckConfigurationFindings,
	factoryPlanHoldReason,
	factoryRepositoryRelative,
	factoryWatchesPullRequest,
	isFactoryHandsOff,
} from "./factory";
import type { AgendaTaskRecord, AgendaTaskRunStatus } from "./tasks";

/**
 * A Factory card's state for people, derived from persisted records only:
 * the one reader of a card's state. Core's `factory_status` tool
 * (`describeFactoryCard`) and the desktop's stage line, Needs you decision
 * and card header read it and only add their own words.
 *
 * Read side only: nothing here writes or decides.
 */

export const FACTORY_CARD_KINDS = [
	"held",
	"queued",
	"scoping",
	"awaiting_approval",
	"running",
	"delivered",
	"delivered_with_findings",
	"concluded",
	/** Stopped; waits for Try again or a fix. */
	"stopped",
	/** Cancelled or expired; nothing more happens. */
	"closed",
	"not_started",
	"archived",
] as const;
export type FactoryCardKind = (typeof FACTORY_CARD_KINDS)[number];

/**
 * Who the card waits on: no one (it moves on its own, or is finished), a free
 * working slot, someone starting or revising it (held, never started, or a
 * plan that cannot be approved; not a decision Factory asks for), or the
 * person's decision. `person` is the desktop's
 * "Needs you": an unrated delivery or an open draft PR without a required
 * stamp never is, because feedback is optional.
 */
export type FactoryCardWaitingOn = "nobody" | "slot" | "start" | "person";

/**
 * Why a card is where it is. Error-text prefixes recorded on the task (and
 * the run) are parsed into these codes only by `factoryErrorReasonCode`.
 */
export const FACTORY_CARD_REASON_CODES = [
	/** Nothing to explain. */
	"none",
	/** Explicitly held before scoping. */
	"held",
	/** Nothing queued or running will start it. */
	"not_started",
	/** Queued while Factory is paused. */
	"factory_paused",
	/** Queued while every working slot is in use. */
	"slots_full",
	/** Scoping asked a question that waits for an answer. */
	"question",
	/** A settled plan waits for a person's approval. */
	"plan_approval",
	/** A settled plan cannot be approved as written (`planApprovable` false); someone revises it. */
	"plan_not_ready",
	/** Automatic approval left a settled plan for a person (FACTORY_AUTO_APPROVAL_WAITING_PREFIX); `planHold` says why. */
	"plan_held",
	/** The designer concluded nothing needs building; a person confirms it. */
	"conclusion",
	/** A delivered result needs a person's stamp. */
	"review_required",
	/** A draft PR is open, without a required stamp; Factory does nothing more. */
	"draft_pr_ready",
	/** The draft PR was merged. */
	"pr_merged",
	/** The draft PR was closed without merging. */
	"pr_closed",
	/** Stopped at the repair limit with the draft PR open and findings left. */
	"open_findings",
	/** PR follow-up was paused; a person resumes it. */
	"followup_paused",
	/** Feedback analysis proposed a guidance rule that waits for the person to save or discard it. */
	"rule_proposed",
	/** A hands-off run's one automatic retry is queued. */
	"auto_retry",
	/** The Hub stopped mid-run (restart queued, or restart limit reached). */
	"interrupted",
	/** The card's own spending limit (FACTORY_SPENDING_LIMIT_PREFIX). */
	"spend_limit",
	/** Factory's daily spending limit. */
	"daily_spend_limit",
	/** The plan's checks are at fault; Try again re-scopes (FACTORY_PLAN_FAULT_PREFIX). */
	"plan_fault",
	/** The plan's checks are at fault and Factory will not re-scope again (FACTORY_PLAN_FAULT_STOPPED_PREFIX). */
	"plan_fault_unfixable",
	/** The draft PR could not be opened (FACTORY_PUBLISH_FAILURE_PREFIX). */
	"publish_failed",
	/** Required verification stayed unavailable after its retries. */
	"verification_unavailable",
	/** The run stopped at its review repair limit. */
	"repair_limit",
	/** The verification profile's preflight failed. */
	"profile_failed",
	/** Scoping did not start, did not complete, or was not saved. */
	"scoping_failed",
	"cancelled",
	"expired",
	"archived",
	/** A recorded error no other code covers. */
	"unknown",
] as const;
export type FactoryCardReasonCode = (typeof FACTORY_CARD_REASON_CODES)[number];

/**
 * Where a card is on the line, in the desktop's names. `waiting` is a state,
 * not a stage: the stage line shows the other five. The plan's
 * deterministic checks, and repository stages after them, are part of Build.
 */
export const FACTORY_CARD_STAGES = [
	"waiting",
	"scope",
	"build",
	"verify",
	"review",
	"delivered",
] as const;
export type FactoryCardStage = (typeof FACTORY_CARD_STAGES)[number];

export interface FactoryCardState {
	kind: FactoryCardKind;
	waitingOn: FactoryCardWaitingOn;
	reasonCode: FactoryCardReasonCode;
	/** One bounded line, repository-relative; absent when there is nothing to say. */
	reasonText?: string;
	/** The stage the card is at; for kind `stopped`, the stage it stopped at. */
	stage: FactoryCardStage;
	/** At Build because the plan's checks (or repository stages) run, or stopped there. */
	checks?: true;
	/** Stages the settled plan leaves out: Verify without a verifier. */
	skipped: FactoryCardStage[];
	/** Why automatic approval left the plan for a person (reason `plan_held`). */
	planHold?: FactoryPlanHoldReason;
	/** The repository stage running now, a sub-step of Build. */
	activeStage?: string;
	/**
	 * The person left a note on the delivery ("Something's off"). A quiet
	 * note only: feedback never changes where the card is or who it waits on.
	 */
	flagged?: true;
	deliverable?: {
		kind: "draft_pr" | "branch";
		url?: string;
		/** What became of the draft PR once it closed. */
		outcome?: "merged" | "closed";
	};
}

/** The task fields the derivation reads; an `AgendaTaskRecord` fits. */
export type FactoryCardTaskFacts = Pick<
	AgendaTaskRecord,
	"status" | "revision"
> &
	Partial<
		Pick<
			AgendaTaskRecord,
			| "archivedAt"
			| "approvedRevision"
			| "error"
			| "factoryQueued"
			| "workspaceRoot"
			| "lastRunId"
		>
	> & {
		factory?: Partial<
			Pick<
				FactoryTaskConfig,
				| "hold"
				| "autonomy"
				| "approval"
				| "humanStamp"
				| "requireIndependentReview"
				| "watchPullRequest"
				| "checks"
				| "agents"
			>
		> & {
			verificationProfile?: Pick<
				NonNullable<FactoryTaskConfig["verificationProfile"]>,
				"origin"
			>;
		};
		factoryDesignProgress?: {
			revision: number;
			phase: "designing" | "reviewing" | "complete";
			conclusion?: { outcome: string; rationale?: string };
		};
		factoryQuestions?: readonly {
			status: string;
			revision: number;
			question: string;
		}[];
	};

/** The Factory run state fields the derivation reads; a `FactoryRunState` fits. */
export type FactoryCardRunStateFacts = Pick<FactoryRunState, "phase"> &
	Partial<
		Pick<
			FactoryRunState,
			| "attempts"
			| "agents"
			| "audit"
			| "autoRecovery"
			| "candidate"
			| "error"
			| "humanApproval"
			| "humanReview"
			| "pullRequestChecks"
			| "pullRequestError"
			| "pullRequestOutcome"
			| "pullRequestUrl"
			| "pullRequestWatch"
			| "reviewEscalation"
			| "reviewSelection"
			| "stagePlan"
			| "unresolvedFindings"
		>
	> & {
		workspace?: { path?: string };
		/** Roles running now, when the attempts are not at hand (the desktop board). */
		activeRoles?: readonly string[];
	};

/** The card's current (or last) run; an `AgendaTaskRunRecord` fits. */
export interface FactoryCardRunFacts {
	status: AgendaTaskRunStatus;
	/** Runs of an earlier revision describe nothing about this one. */
	taskRevision?: number;
	/** Tells the run whose failure scheduled an automatic retry from a later one. */
	createdAt?: string;
	error?: string;
	factory?: FactoryCardRunStateFacts;
}

/** What only the live Hub knows; all default to false. */
export interface FactoryCardLiveFacts {
	/** A scoping (design or plan review) session is live for this card. */
	designLive?: boolean;
	/** An execution run is live for this card. */
	runLive?: boolean;
	/** Every working slot is in use. */
	slotsFull?: boolean;
	/** Factory is paused. */
	paused?: boolean;
}

export interface FactoryCardStateInput {
	task: FactoryCardTaskFacts;
	lastRun?: FactoryCardRunFacts;
	live?: FactoryCardLiveFacts;
	/**
	 * Whether the card's plan for its revision can be approved as written
	 * (`factoryPlanApprovalBlocker` finds nothing). Hosts with the full record
	 * pass it: a plan written without scoping waits for approval only when
	 * true, a settled plan that cannot be approved (false) waits for someone
	 * to revise it rather than for a decision.
	 */
	planApprovable?: boolean;
}

const REASON_TEXT_CHARS = 200;

/** First meaningful line, long tokens elided, bounded (as core's summarizeFactoryError). */
function oneLine(text: string): string {
	const line =
		text
			.split(/\r?\n/)
			.map((entry) => entry.trim())
			.find((entry) => entry && !/^(at |\s*[{}[\]]$)/.test(entry)) ?? "";
	const clean = line
		.replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, "…")
		.replace(/\s+/g, " ");
	return clean.length > REASON_TEXT_CHARS
		? `${clean.slice(0, REASON_TEXT_CHARS - 1)}…`
		: clean;
}

/** "Could not open the draft PR: …", or an older run's "Could not confirm the draft PR…". */
const PUBLISH_FAILURE = /^Could not (?:open|confirm) the draft PR\b/;
const REPAIR_LIMIT = /^Repair limit \(\d+\) reached/;
const PROFILE_FAILURE = "Verification profile failed (";
const VERIFICATION_UNAVAILABLE = "Required verification remains unavailable";
const DAILY_SPENDING_LIMIT = "Factory reached its $";
const SCOPING_FAILURE =
	/^Design (?:did not start|did not complete|was not saved)\b/;
const INTERRUPTED =
	/^(?:Factory restarted this run \d+ times? after the Hub stopped|Hub task manager stopped before|Hub restarted (?:while|before)|Factory host stopped or lost ownership|Factory run ownership was lost)/;

/**
 * The reason code a recorded task or run error encodes. The one place the
 * error-text prefixes are read; undefined or blank text is `none`, text no
 * prefix matches is `unknown`.
 */
export function factoryErrorReasonCode(
	error: string | undefined,
): FactoryCardReasonCode {
	const text = error?.trim();
	if (!text) return "none";
	if (text.startsWith(FACTORY_AUTO_APPROVAL_WAITING_PREFIX.trim()))
		return "plan_held";
	if (text.startsWith(FACTORY_PLAN_FAULT_STOPPED_PREFIX.trim()))
		return "plan_fault_unfixable";
	if (text.startsWith(FACTORY_PLAN_FAULT_PREFIX.trim())) return "plan_fault";
	if (
		text.startsWith(FACTORY_PUBLISH_FAILURE_PREFIX.trim()) ||
		PUBLISH_FAILURE.test(text)
	)
		return "publish_failed";
	if (text.startsWith(FACTORY_SPENDING_LIMIT_PREFIX)) return "spend_limit";
	if (text.startsWith(DAILY_SPENDING_LIMIT)) return "daily_spend_limit";
	if (REPAIR_LIMIT.test(text)) return "repair_limit";
	if (text.startsWith(PROFILE_FAILURE)) return "profile_failed";
	if (text.startsWith(VERIFICATION_UNAVAILABLE))
		return "verification_unavailable";
	if (SCOPING_FAILURE.test(text)) return "scoping_failed";
	if (INTERRUPTED.test(text)) return "interrupted";
	return "unknown";
}

type Place = { stage: FactoryCardStage; checks?: boolean };
type Fields = Pick<FactoryCardState, "kind" | "waitingOn" | "reasonCode"> &
	Partial<
		Pick<
			FactoryCardState,
			"reasonText" | "planHold" | "activeStage" | "deliverable"
		>
	>;

/** The run error older Hubs recorded with a person's note on a delivery. */
export const FACTORY_LEGACY_FEEDBACK_STOP = "Human sample finding: ";

const running = (attempt: { status: string }) =>
	attempt.status === "intent" || attempt.status === "running";

/**
 * The card's state from its persisted task record, its current (or last)
 * run and what the live Hub knows. Pure; never throws for a well-typed input.
 */
export function factoryCardState(
	input: FactoryCardStateInput,
): FactoryCardState {
	const state = deriveFactoryCardState(input);
	if (!input.task.archivedAt) return state;
	// Archived cards keep their stage; nothing waits on them.
	const { reasonText: _text, planHold: _hold, ...rest } = state;
	return {
		...rest,
		kind: "archived",
		waitingOn: "nobody",
		reasonCode: "archived",
	};
}

function deriveFactoryCardState({
	task,
	lastRun,
	live = {},
	planApprovable,
}: FactoryCardStateInput): FactoryCardState {
	const run =
		lastRun &&
		(lastRun.taskRevision === undefined ||
			lastRun.taskRevision === task.revision)
			? lastRun
			: undefined;
	const recorded = run?.factory;
	// Older runs recorded a person's note as a stop; feedback never stops a
	// delivery, so such a run reads as delivered until the Hub normalises it.
	const state: FactoryCardRunStateFacts | undefined =
		recorded?.phase === "blocked" &&
		recorded.audit?.finding &&
		recorded.error?.startsWith(FACTORY_LEGACY_FEEDBACK_STOP)
			? { ...recorded, phase: "ready", error: undefined }
			: recorded;
	const design =
		task.factoryDesignProgress?.revision === task.revision
			? task.factoryDesignProgress
			: undefined;
	const working = Boolean(live.designLive || live.runLive);
	const queued = task.factoryQueued !== undefined;
	const handsOff = isFactoryHandsOff(task.factory);
	const question = task.factoryQuestions?.find(
		(entry) => entry.status === "pending" && entry.revision === task.revision,
	);
	const text = (value: string | undefined) => {
		if (!value) return undefined;
		const line = oneLine(
			factoryRepositoryRelative(value, [
				state?.workspace?.path,
				task.workspaceRoot,
			]),
		);
		return line || undefined;
	};
	const deliverable: FactoryCardState["deliverable"] = state?.pullRequestUrl
		? {
				kind: "draft_pr",
				url: state.pullRequestUrl,
				...(state.pullRequestOutcome
					? { outcome: state.pullRequestOutcome.state }
					: {}),
			}
		: undefined;
	const hasChecks = (task.factory?.checks?.length ?? 0) > 0;
	const verifierRunning = Boolean(
		state?.attempts?.some(
			(attempt) => attempt.role === "verifier" && running(attempt),
		) || state?.activeRoles?.includes("verifier"),
	);
	// Scoping writes the checks and may add a verifier; until the plan
	// settles nothing is skipped.
	const settled =
		task.approvedRevision === task.revision ||
		design?.phase === "complete" ||
		["in_progress", "completed", "failed"].includes(task.status);
	const hasVerifier = Boolean(
		state?.candidate?.verification ||
			state?.attempts?.some((attempt) => attempt.role === "verifier") ||
			(state?.agents ?? task.factory?.agents)?.verifier,
	);
	const skipped: FactoryCardStage[] =
		task.factory && settled && !hasVerifier ? ["verify"] : [];
	const activeStage = state ? factoryActiveStage(state) : undefined;

	const make = (fields: Fields, place: Place): FactoryCardState => {
		const {
			reasonText,
			planHold,
			activeStage: stage,
			deliverable: output,
		} = fields;
		return {
			kind: fields.kind,
			waitingOn: fields.waitingOn,
			reasonCode: fields.reasonCode,
			...(reasonText ? { reasonText } : {}),
			stage: place.stage,
			...(place.checks ? { checks: true as const } : {}),
			skipped,
			...(planHold ? { planHold } : {}),
			...(stage ? { activeStage: stage } : {}),
			...(state?.audit?.finding ? { flagged: true as const } : {}),
			...(output ? { deliverable: output } : {}),
		};
	};

	/** Where a run phase places the card; undefined for `blocked`. */
	const phasePlace = (completed: boolean): Place | undefined => {
		switch (state?.phase) {
			case "implementing":
			case "repairing":
				return { stage: "build" };
			case "verifying":
				// Checks (and repository stages) run first, then the verifier.
				if (verifierRunning) return { stage: "verify" };
				if (hasChecks || activeStage) return { stage: "build", checks: true };
				return { stage: skipped.includes("verify") ? "review" : "verify" };
			case "reviewing":
			case "publishing":
				return { stage: "review" };
			case "watching":
				// The draft PR is open and Factory keeps it green.
				return { stage: completed ? "delivered" : "review" };
			case "ready":
				return { stage: "delivered" };
			default:
				return undefined;
		}
	};

	/**
	 * Where a stopped card stopped. A blocked run does not record the phase
	 * it left, so it is placed by what it recorded: a plan fault at its
	 * checks, a draft PR that could not open at Review, and the task error's
	 * words otherwise.
	 */
	const stoppedPlace = (): Place => {
		const code = factoryErrorReasonCode(task.error);
		if (
			task.status === "failed" &&
			(code === "plan_fault" ||
				code === "plan_fault_unfixable" ||
				factoryCheckConfigurationFindings(
					task.factory?.checks ?? [],
					task.workspaceRoot,
				).length > 0)
		)
			return { stage: "build", checks: true };
		if (!state)
			return {
				stage: task.approvedRevision === task.revision ? "build" : "scope",
			};
		if (state.pullRequestError || code === "publish_failed")
			return { stage: "review" };
		if (state.unresolvedFindings?.findings.length) return { stage: "review" };
		if (
			hasChecks &&
			state.candidate?.checks?.some((check) => check.status !== "passed")
		)
			return { stage: "build", checks: true };
		// Desktop events may carry a partial candidate.
		const candidate = state.candidate;
		if (
			candidate?.verification &&
			candidate.verification.review.verdict !== "pass"
		)
			return { stage: "verify" };
		if (candidate?.reviews?.some((entry) => entry.review.verdict !== "pass"))
			return { stage: "review" };
		const at = phasePlace(false);
		if (at) return at.stage === "delivered" ? { stage: "review" } : at;
		const error = task.error ?? "";
		if (/\b(verif|tester|app environment)/i.test(error))
			return { stage: "verify" };
		if (/\breview/i.test(error)) return { stage: "review" };
		if (/\bcheck/i.test(error)) return { stage: "build", checks: true };
		return { stage: "build" };
	};

	const stopped = (errorText: string | undefined): FactoryCardState => {
		const code = factoryErrorReasonCode(errorText);
		return make(
			{
				kind: "stopped",
				waitingOn: "person",
				reasonCode: code === "none" ? "unknown" : code,
				reasonText: text(errorText),
				deliverable,
			},
			stoppedPlace(),
		);
	};

	/** Nothing queued or running will start it: hands-off cards should have moved on their own. */
	const notStarted = () =>
		make(
			{
				kind: "not_started",
				waitingOn: handsOff ? "nobody" : "start",
				reasonCode: "not_started",
			},
			{ stage: "waiting" },
		);

	/** A card waiting in the queue: why it has not started yet. */
	const waitInQueue = (): FactoryCardState => {
		// The run that failed and scheduled the retry is still the last run
		// (a person's later retry follows a run created after it).
		const recovery = state?.autoRecovery;
		const autoRetry =
			task.status === "approved" &&
			run?.status === "failed" &&
			(recovery?.attempts ?? 0) > 0 &&
			!(
				run.createdAt &&
				recovery &&
				Date.parse(run.createdAt) > Date.parse(recovery.at)
			);
		const reason: Pick<Fields, "reasonCode" | "reasonText"> = live.paused
			? { reasonCode: "factory_paused", reasonText: "Factory is paused" }
			: live.slotsFull
				? {
						reasonCode: "slots_full",
						reasonText: "Every working slot is in use",
					}
				: task.status === "approved" && run?.status === "interrupted"
					? { reasonCode: "interrupted" }
					: autoRetry
						? {
								reasonCode: "auto_retry",
								reasonText: text(recovery?.reason),
							}
						: { reasonCode: "none" };
		return make(
			{ kind: "queued", waitingOn: "slot", ...reason, deliverable },
			// The automatic retry builds again; it is not back in Waiting.
			{ stage: autoRetry ? "build" : "waiting" },
		);
	};

	// Closed cards: where they were, not stopped.
	if (task.status === "cancelled" || task.status === "expired")
		return make(
			{
				kind: "closed",
				waitingOn: "nobody",
				reasonCode: task.status,
				reasonText: text(task.error),
				deliverable,
			},
			phasePlace(false) ?? { stage: "waiting" },
		);

	// Stopped at the repair limit after its draft PR opened: the PR is the
	// result, waiting for a person to judge the open findings.
	if (
		task.status === "failed" &&
		state?.phase === "blocked" &&
		state.pullRequestUrl &&
		state.unresolvedFindings?.pullRequestOpen
	) {
		const count = state.unresolvedFindings.findings.length;
		return make(
			{
				kind: "delivered_with_findings",
				waitingOn: state.humanApproval ? "nobody" : "person",
				reasonCode: "open_findings",
				reasonText: `${count} unresolved ${count === 1 ? "finding" : "findings"}`,
				deliverable,
			},
			{ stage: "delivered" },
		);
	}

	// A failure, or a recorded error at any other status (scoping that
	// stopped, for one). Automatic approval's waiting note is not a stop.
	const taskCode = factoryErrorReasonCode(task.error);
	if (
		task.status === "failed" ||
		(taskCode !== "none" && taskCode !== "plan_held")
	)
		return stopped(task.error || state?.error || run?.error);

	if (
		state?.phase === "blocked" &&
		(task.status === "in_progress" || task.status === "completed")
	)
		return stopped(state.error || run?.error);

	// A guidance rule proposed from feedback waits for the person to save or
	// discard it; the note itself never does.
	const audit = state?.audit;
	if (audit?.finding && audit.analysis?.status === "proposed")
		return make(
			{
				kind: "delivered",
				waitingOn: "person",
				reasonCode: "rule_proposed",
				deliverable: deliverable ?? { kind: "branch" },
			},
			phasePlace(true) ?? { stage: "delivered" },
		);

	if (state?.humanApproval && task.status !== "approved")
		return make(
			{
				kind: "delivered",
				waitingOn: "nobody",
				reasonCode: "none",
				deliverable: deliverable ?? { kind: "branch" },
			},
			{ stage: "delivered" },
		);

	if (task.status === "completed") {
		const place = phasePlace(true) ?? { stage: "delivered" };
		const delivered = (fields: Omit<Fields, "kind" | "deliverable">) =>
			make(
				{
					kind: "delivered",
					...fields,
					deliverable: deliverable ?? { kind: "branch" },
				},
				place,
			);
		if (state?.pullRequestOutcome)
			return delivered({
				waitingOn: "nobody",
				reasonCode:
					state.pullRequestOutcome.state === "merged"
						? "pr_merged"
						: "pr_closed",
			});
		if (state?.pullRequestWatch?.paused)
			return delivered({ waitingOn: "person", reasonCode: "followup_paused" });
		// Frozen at delivery; runs from before that ask for no stamp.
		const stamp = state?.humanReview;
		// The stamp is asked for once the result settled: ready, or watched
		// with CI passed on the delivered commit and nothing to repair.
		const settledResult =
			state?.phase === "ready" ||
			(state?.phase === "watching" &&
				!state.pullRequestWatch?.pending &&
				state.pullRequestChecks?.status === "passed" &&
				state.pullRequestChecks.headCommit === state.candidate?.commit);
		if (stamp?.required && settledResult)
			return delivered({
				waitingOn: "person",
				reasonCode: "review_required",
				reasonText: stamp.reason,
			});
		const watched =
			factoryWatchesPullRequest(task.factory) &&
			!state?.pullRequestWatch?.paused;
		return delivered({
			waitingOn: "nobody",
			reasonCode:
				state?.pullRequestUrl && !audit?.reviewedAt && !watched
					? "draft_pr_ready"
					: "none",
		});
	}

	if (
		task.status === "in_progress" ||
		(task.status === "approved" && live.runLive)
	) {
		if (state?.phase === "ready" || state?.phase === "watching")
			return make(
				{
					kind: "delivered",
					waitingOn: "nobody",
					reasonCode: "none",
					deliverable: deliverable ?? { kind: "branch" },
				},
				phasePlace(false) ?? { stage: "delivered" },
			);
		return make(
			{
				kind: "running",
				waitingOn: "nobody",
				reasonCode: "none",
				activeStage,
				deliverable,
			},
			phasePlace(false) ?? { stage: "build" },
		);
	}

	// A designer conclusion waits for a person in every status before a run:
	// nothing closes the card for them, and it is never queued.
	if (design?.phase === "complete" && design.conclusion)
		return make(
			{
				kind: "concluded",
				waitingOn: "person",
				reasonCode: "conclusion",
				reasonText: text(
					design.conclusion.rationale
						? `${design.conclusion.outcome}: ${design.conclusion.rationale}`
						: design.conclusion.outcome,
				),
			},
			{ stage: "scope" },
		);

	if (task.status === "approved") return queued ? waitInQueue() : notStarted();

	// pending_approval
	if (task.factory?.hold && !design)
		return make(
			{ kind: "held", waitingOn: "start", reasonCode: "held" },
			{ stage: "waiting" },
		);
	if (question)
		return make(
			{
				kind: "scoping",
				waitingOn: "person",
				reasonCode: "question",
				reasonText: text(question.question),
			},
			{ stage: "scope" },
		);
	const planHold = factoryPlanHoldReason(task.error);
	if (planHold)
		return make(
			{
				kind: "awaiting_approval",
				waitingOn: "person",
				reasonCode: "plan_held",
				planHold,
				reasonText: text(
					task.error?.slice(FACTORY_AUTO_APPROVAL_WAITING_PREFIX.length),
				),
			},
			{ stage: "scope" },
		);
	const automatic = task.factory?.approval === "automatic";
	// A plan written without scoping, ready for a person's approval.
	if (!design && planApprovable === true && !automatic)
		return make(
			{
				kind: "awaiting_approval",
				waitingOn: "person",
				reasonCode: "plan_approval",
			},
			{ stage: "scope" },
		);
	if (design?.phase === "complete")
		// Automatic approval approves a settled plan in the same pass, or
		// records why it did not; a plan still here (a restored one, say)
		// waits for a person like any other. One that cannot be approved as
		// written waits for someone to revise it, unless automatic approval
		// was meant to take it.
		return make(
			planApprovable !== false
				? {
						kind: "awaiting_approval",
						waitingOn: "person",
						reasonCode: "plan_approval",
					}
				: automatic
					? {
							kind: "awaiting_approval",
							waitingOn: "person",
							reasonCode: "plan_held",
							planHold: "not_ready",
						}
					: {
							kind: "awaiting_approval",
							waitingOn: "start",
							reasonCode: "plan_not_ready",
						},
			{ stage: "scope" },
		);
	if (working)
		return make(
			{ kind: "scoping", waitingOn: "nobody", reasonCode: "none" },
			{ stage: "scope" },
		);
	if (queued) return waitInQueue();
	return notStarted();
}

/**
 * How urgent the person's decision on a card is, lower first: stopped work,
 * a question, a plan or conclusion to confirm, a delivery to review, a
 * proposed rule. Undefined unless the card waits on a person. The board and
 * `factory_status` both order Needs you by it (`compareFactoryNeedsYou`).
 */
export function factoryNeedsYouUrgency(
	card: Pick<FactoryCardState, "kind" | "waitingOn" | "reasonCode">,
): number | undefined {
	if (card.waitingOn !== "person") return undefined;
	switch (card.kind) {
		case "stopped":
			return 0;
		case "scoping":
			return 1;
		case "awaiting_approval":
		case "concluded":
			return 2;
		default:
			return card.reasonCode === "rule_proposed" ? 4 : 3;
	}
}

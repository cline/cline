"use client";

import type {
	AgendaTaskRecord,
	FactoryCardState,
	FactoryPriority,
	FactoryRunState,
} from "@cline/shared";
import {
	DEFAULT_FACTORY_AGENTS,
	FACTORY_PRIORITIES,
	FACTORY_PRIORITY_LABEL,
	factoryActiveStage,
	factoryCardState,
	isFactoryHandsOff,
} from "@cline/shared/browser";
import {
	AlertTriangle,
	Archive,
	ArrowLeft,
	ArrowUpRight,
	CheckCircle2,
	CircleSlash,
	ClipboardCheck,
	Clock,
	FolderGit2,
	GitPullRequest,
	HelpCircle,
	ListTree,
	Loader2,
	MoreHorizontal,
	PauseCircle,
	PencilLine,
	PlayCircle,
} from "lucide-react";
import {
	type ComponentType,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FactoryLiveActivity } from "@/hooks/use-factory-live-activity";
import { basenamePath } from "@/hooks/use-session-history";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import {
	currentFactoryConclusion,
	type FactoryRetryRun,
	factoryAutoApprovalWaiting,
	factoryAutoRetrying,
	factoryAutoRetryLabel,
	factoryCardInput,
	factoryOpenFindings,
	factoryPublishFailureReason,
	factoryRepairLimitReason,
	factoryScopingWait,
	isFactoryRuleCard,
	isReplayReviewQueued,
} from "@/lib/factory-attention";
import {
	FACTORY_ACTIVITY,
	FACTORY_CARD,
	FACTORY_CARD_ACTION,
	FACTORY_CHECK_RESULT,
	FACTORY_DECISION,
	FACTORY_DUPLICATES,
	FACTORY_NOT_STARTED,
	FACTORY_OPEN_FINDINGS,
	FACTORY_PHASE_LABEL,
	FACTORY_PRIORITY,
	FACTORY_PROOF,
	FACTORY_READY,
	FACTORY_RECOVERY,
	FACTORY_RULE_CARD,
	FACTORY_SCOPE_ROUTE,
	FACTORY_SPLIT,
	FACTORY_STAGES,
	factoryPullRequestActionLabel,
	factoryReviewRequest,
} from "@/lib/factory-copy";
import { cn } from "@/lib/utils";
import {
	FactoryStationLine,
	factoryCardStations,
	factoryStation,
} from "./factory-line";
import {
	activeFactorySessions,
	FactoryLiveLine,
	type FactoryLiveSession,
} from "./factory-live";
import { FactoryParentLink, type FactorySplitContext } from "./factory-split";
import {
	FactoryIdChip,
	FactoryPriorityGlyph,
	FactoryRuleBadge,
	type FactoryTone,
	factoryShortId,
	hasFactoryPriority,
	toneSurface,
	toneText,
} from "./factory-ui";

/**
 * Pipeline steps. Deterministic checks belong to Build; Verify is only the
 * independent verifier agent exercising the app, and is omitted when the
 * card's workflow has no verifier.
 */
export type FactoryStageKey =
	| "scope"
	| "plan_review"
	| "approve"
	| "build"
	| "verify"
	| "review"
	| "deliver";

const running = (attempt: { status: string }) =>
	attempt.status === "intent" || attempt.status === "running";

/** Whether the run's frozen workflow (or the card's) has a verifier agent. */
export function factoryHasVerifier(
	task: Pick<AgendaTaskRecord, "factory">,
	state: FactoryRunState | undefined,
): boolean {
	if (
		state?.candidate?.verification ||
		state?.attempts?.some((attempt) => attempt.role === "verifier")
	)
		return true;
	return Boolean(
		(state?.agents ?? task.factory?.agents ?? DEFAULT_FACTORY_AGENTS).verifier,
	);
}

/** The verifier agent (or the app it tests) is running for this candidate. */
function verifierActive(state: FactoryRunState): boolean {
	return Boolean(
		state.verifierEnvironment ||
			state.attempts?.some(
				(attempt) => attempt.role === "verifier" && running(attempt),
			),
	);
}

const checksFailed = (
	candidate:
		| Pick<NonNullable<FactoryRunState["candidate"]>, "checks">
		| undefined,
) => Boolean(candidate?.checks.some((check) => check.status !== "passed"));

/**
 * Phase → step:
 * implementing, repairing → build; verifying → verify while the verifier
 * agent or its app runs, otherwise build (deterministic checks); reviewing →
 * review; publishing, watching, ready → deliver; blocked → the step that
 * stopped it (failed checks → build, failed verification → verify, failed
 * reviews → review; a draft PR that could not be opened, or a candidate that
 * passed everything and has no PR → deliver; else build).
 */
export function factoryExecutionStage(
	state: FactoryRunState,
	/** The task's stored error, which may say publishing failed. */
	taskError?: string,
): FactoryStageKey {
	switch (state.phase) {
		case "implementing":
		case "repairing":
			return "build";
		case "verifying":
			return verifierActive(state) ? "verify" : "build";
		case "reviewing":
			return "review";
		case "publishing":
		case "watching":
		case "ready":
			return "deliver";
		case "blocked": {
			// Review findings outlasted the repair rounds.
			if (factoryRepairLimitReason(state.error ?? taskError) !== undefined)
				return "review";
			// The draft PR could not be opened: build, checks and any review
			// before it passed.
			if (factoryPublishFailed(state, taskError)) return "deliver";
			const candidate = state.candidate;
			if (!candidate || checksFailed(candidate)) return "build";
			if (
				candidate.verification &&
				candidate.verification.review.verdict !== "pass"
			)
				return "verify";
			if (candidate.reviews.some((entry) => entry.review.verdict !== "pass"))
				return "review";
			return "build";
		}
	}
}

/**
 * A run that stopped at the draft PR: core says so, or its candidate passed
 * checks, verification and review and no PR was opened.
 */
export function factoryPublishFailed(
	state: FactoryRunState | undefined,
	taskError?: string,
): boolean {
	if (state?.pullRequestUrl) return false;
	// The workflow stopped at its repair limit, before any PR.
	if (factoryRepairLimitReason(state?.error ?? taskError) !== undefined)
		return false;
	if (
		factoryPublishFailureReason(taskError) !== undefined ||
		(state &&
			(state.pullRequestError ||
				factoryPublishFailureReason(state.error) !== undefined))
	)
		return true;
	const candidate = state?.phase === "blocked" ? state.candidate : undefined;
	return Boolean(
		candidate &&
			candidate.checks.length > 0 &&
			!checksFailed(candidate) &&
			(!candidate.verification ||
				candidate.verification.review.verdict === "pass") &&
			candidate.reviews.length > 0 &&
			candidate.reviews.every((entry) => entry.review.verdict === "pass"),
	);
}

/** "Building · running checks (2 of 4)" while deterministic checks run. */
function checksHeadline(
	task: AgendaTaskRecord,
	state: FactoryRunState,
): string {
	const total =
		state.inputSnapshot?.factory.checks.length ??
		task.factory?.checks.length ??
		0;
	const done = state.candidate?.checks.length ?? 0;
	if (total && done > 0 && done < total)
		return `Building · running checks (${done} of ${total})`;
	return total
		? `Building · running ${total === 1 ? "1 check" : `${total} checks`}`
		: "Building · running checks";
}

function executionHeadline(
	task: AgendaTaskRecord,
	state: FactoryRunState,
): string {
	const max = task.factory?.maxRepairRounds ?? 0;
	const round =
		state.repairRound > 0 && max > 0
			? ` (round ${state.repairRound} of ${max})`
			: "";
	// A repository stage is a sub-step of Build: "Build · Security scan".
	const stage = factoryActiveStage(state);
	if (
		stage &&
		(state.phase === "implementing" ||
			state.phase === "repairing" ||
			state.phase === "verifying")
	)
		return FACTORY_STAGES.subStep(stage);
	switch (state.phase) {
		case "implementing":
			return `${FACTORY_PHASE_LABEL.implementing}${round}`;
		case "repairing":
			return `${
				checksFailed(state.candidateHistory?.at(-1))
					? "Fixing failed checks"
					: FACTORY_PHASE_LABEL.repairing
			}${round}`;
		case "verifying":
			return verifierActive(state)
				? `${FACTORY_PHASE_LABEL.verifying} the running app`
				: checksHeadline(task, state);
		case "reviewing":
			return `${FACTORY_PHASE_LABEL.reviewing}${round}`;
		case "publishing":
		case "watching":
		case "ready":
		case "blocked":
			return FACTORY_PHASE_LABEL[state.phase];
	}
}

/** The title of a stopped card, in plain words. */
function stoppedHeadline(
	task: AgendaTaskRecord,
	state: FactoryRunState | undefined,
): string {
	if (factoryRepairLimitReason(state?.error ?? task.error) !== undefined)
		return FACTORY_CARD.repairLimitHeadline;
	if (factoryPublishFailed(state, task.error))
		return FACTORY_RECOVERY.publishFailed;
	const max = task.factory?.maxRepairRounds ?? 0;
	if (state && max > 0 && state.repairRound >= max)
		return `Stopped after ${max} repair ${max === 1 ? "attempt" : "attempts"}`;
	if (
		state &&
		factoryExecutionStage(state) === "build" &&
		checksFailed(state.candidate)
	)
		// Only checks their own setup blocked: the plan needs fixing, not the code.
		return state.candidate?.checks.every(
			(check) =>
				check.status === "passed" || check.blockedBy === "configuration",
		)
			? FACTORY_CHECK_RESULT.configuration
			: "Checks did not pass";
	if (!state && !task.lastRunId) return "Scoping stopped";
	return task.status === "failed" ? "Stopped" : "Blocked";
}

/**
 * Scoping ran and stopped before the plan settled ("Design did not
 * complete: …"); the card still waits for approval. The station line marks
 * the same error as stopped at Scope. Core's own "waiting for approval"
 * note is not a stop.
 */
export function factoryScopingStopped(
	task: Pick<AgendaTaskRecord, "status" | "error" | "archivedAt">,
): boolean {
	return (
		!task.archivedAt &&
		task.status === "pending_approval" &&
		Boolean(task.error) &&
		factoryAutoApprovalWaiting(task) === null
	);
}

/** Why scoping stopped, in plain words, from the task's error. */
export function factoryScopingStopReason(error: string | undefined): string {
	const limit = /Plan repair limit \((\d+)\) reached/i.exec(error ?? "");
	if (!limit) return "Scoping did not finish.";
	const rounds = Number(limit[1]);
	return `The plan checkers still had objections after ${rounds} ${rounds === 1 ? "round" : "rounds"} of fixes.`;
}

type Summary = {
	tone: FactoryTone;
	icon: ComponentType<{ className?: string }>;
	headline: string;
	/** The current step; "done" when every step is complete. */
	stage: FactoryStageKey | "done" | undefined;
	spinning?: boolean;
	stopped?: boolean;
	/** The current step finished with open issues: amber, not failed. */
	warning?: boolean;
	/** Nothing queued or running will start this card; it needs Start. */
	notStarted?: boolean;
	/** A brief nobody scoped: approve it as written, or scope it first. */
	unscoped?: boolean;
	/** Scoping waits for the person's answer. */
	question?: boolean;
	/** A rule Factory proposed from the person's note waits for them. */
	rule?: boolean;
	/** A split's parent: its parts do the work. */
	parent?: boolean;
	/** Scoping split the request; the breakdown waits for the person. */
	breakdown?: boolean;
	/** A part waiting for earlier parts' pull requests to be merged. */
	waitingPart?: boolean;
	/** A part whose earlier part will never merge: Start anyway, or cancel. */
	startAnyway?: boolean;
};

/**
 * A card nothing will start on its own: on hold, or with no finished plan
 * for its revision that the Hub has not queued, that is not scoping and (for
 * work that waits for approval) cannot be approved as written. Its one action
 * is Start, shown in the status header; the card offers no other way in.
 * Activity calls the same cards "Not started" or "On hold".
 */
export function factoryAwaitingStart(
	task: AgendaTaskRecord,
	{
		autoProgress,
		designActive,
		approvalReason,
	}: {
		autoProgress: boolean;
		designActive: boolean;
		approvalReason: string | null;
	},
): boolean {
	if (
		task.archivedAt ||
		task.status !== "pending_approval" ||
		factoryScopingStopped(task) ||
		designActive ||
		autoProgress ||
		currentFactoryConclusion(task) ||
		isReplayReviewQueued(task)
	)
		return false;
	const progress = task.factoryDesignProgress;
	if (progress?.revision === task.revision && progress.phase === "complete")
		return false;
	const wait = factoryScopingWait(task);
	if (wait === "held") return true;
	if (wait === "queued" || task.factoryQueued !== undefined) return false;
	return isFactoryHandsOff(task.factory) || approvalReason !== null;
}

/** A stopped card's reason without a lead-in its headline already says. */
function withoutHeadlineLead(
	reason: string | undefined,
	headline: string,
): string | undefined {
	if (!reason) return reason;
	let rest = reason.replace(
		/^The plan's checks (?:still )?need fixing:\s*/,
		"",
	);
	if (rest.toLowerCase().startsWith(`${headline.toLowerCase()}:`))
		rest = rest.slice(headline.length + 1).trimStart();
	return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : undefined;
}

/** One plain-language status and pipeline position for the whole task. */
function summarize(
	task: AgendaTaskRecord,
	state: FactoryRunState | undefined,
	designActive: boolean,
	approvalReason: string | null,
	autoProgress: boolean,
	runs: readonly FactoryRetryRun[] | undefined,
	/** Findings left on an open draft PR when the run stopped at its limit. */
	openFindings: number | undefined,
	/** The run stopped because the plan's checks, not the code, are at fault. */
	planFault: "retry" | "stopped" | undefined,
	/** Where the card is and who it waits on, from factoryCardState. */
	card: FactoryCardState,
	/** Scoping asked the person a question and waits for the answer. */
	waitingForAnswer = false,
	/** Why an earlier part of a split will never merge. */
	unmergedReason?: string,
): Summary {
	if (task.archivedAt)
		return {
			tone: "neutral",
			icon: Archive,
			headline: "Archived",
			stage: undefined,
		};
	if (task.status === "cancelled" || task.status === "expired")
		return {
			tone: "neutral",
			icon: CircleSlash,
			headline: task.status === "cancelled" ? "Cancelled" : "Expired",
			stage: undefined,
		};
	switch (card.reasonCode) {
		// A parent's page lists its parts instead of the stage line.
		case "tracking":
		case "parts_delivered":
			return {
				tone: card.reasonCode === "tracking" ? "neutral" : "success",
				icon: ListTree,
				headline:
					card.reasonCode === "tracking"
						? FACTORY_SPLIT.parentHeadline(
								task.factorySplit?.parts.filter((item) => !item.omitted)
									.length ?? 0,
							)
						: FACTORY_SPLIT.parentDone,
				stage: undefined,
				parent: true,
			};
		case "parts_closed":
			return {
				tone: "neutral",
				icon: CircleSlash,
				// The parts list below gives the numbers.
				headline: FACTORY_SPLIT.parentClosed,
				stage: undefined,
				parent: true,
			};
		case "split_approval":
			return {
				tone: "accent",
				icon: ListTree,
				headline: FACTORY_SPLIT.approvalHeadline,
				stage: "approve",
				breakdown: true,
			};
		case "waiting_on_card":
			return {
				tone: "neutral",
				icon: Clock,
				headline: card.reasonText ?? FACTORY_ACTIVITY.waitingToStart,
				stage: "scope",
				waitingPart: true,
			};
		case "dependency_unavailable":
			return {
				tone: "attention",
				icon: AlertTriangle,
				// The engine's reason alone: the next line says what to do.
				headline: unmergedReason ?? "",
				stage: "scope",
				startAnyway: true,
			};
	}
	const executionStage: FactoryStageKey = state
		? factoryExecutionStage(state, task.error)
		: "build";
	if (state?.humanApproval)
		return {
			tone: "success",
			icon: CheckCircle2,
			headline: FACTORY_ACTIVITY.reviewed,
			stage: "done",
		};
	if (openFindings !== undefined)
		return {
			tone: "attention",
			icon: GitPullRequest,
			headline: FACTORY_OPEN_FINDINGS.headline(openFindings),
			stage: "deliver",
			warning: true,
		};
	if (
		currentFactoryConclusion(task) &&
		task.status !== "in_progress" &&
		task.status !== "completed"
	)
		return {
			tone: "attention",
			icon: CircleSlash,
			headline: "No build needed",
			stage: "scope",
		};
	if (factoryAutoRetrying(task, state, runs))
		return {
			tone: "working",
			icon: Loader2,
			headline: factoryAutoRetryLabel(state?.autoRecovery),
			stage: executionStage,
			spinning: true,
		};
	if (factoryScopingStopped(task))
		return {
			tone: "danger",
			icon: AlertTriangle,
			headline: "Scoping stopped",
			stage: "scope",
			stopped: true,
		};
	// The plan's checks are at fault: scoping wrote them and fixes them, so
	// the scoping step is the one marked, whatever step the run reached.
	if (planFault && task.status === "failed")
		return {
			tone: "danger",
			icon: AlertTriangle,
			headline:
				planFault === "stopped"
					? FACTORY_CARD.planFaultStoppedHeadline
					: FACTORY_CARD.planFaultHeadline,
			stage: "scope",
			stopped: true,
		};
	// A rule proposed from the person's note waits for them; the note alone
	// leaves the delivery as it is.
	if (card.reasonCode === "rule_proposed")
		return {
			tone: "attention",
			icon: ClipboardCheck,
			headline: FACTORY_DECISION.rule,
			stage: "deliver",
			rule: true,
		};
	if (card.kind === "stopped")
		return {
			tone: "danger",
			icon: AlertTriangle,
			headline: stoppedHeadline(task, state),
			stage:
				task.status === "failed" && !state
					? designActive || !task.lastRunId
						? "scope"
						: factoryPublishFailed(undefined, task.error)
							? "deliver"
							: "build"
					: executionStage,
			stopped: true,
		};
	if (task.status === "in_progress")
		return {
			tone: "working",
			icon: Loader2,
			headline: state ? executionHeadline(task, state) : "Starting to build",
			stage: executionStage,
			spinning: true,
		};
	// A blocked run that is not a stop here is an older Hub's feedback note:
	// the delivery stands.
	if (task.status === "completed")
		return !state || state.phase === "ready" || state.phase === "blocked"
			? {
					// Core asked for the user's review at delivery.
					tone: card.reasonCode === "review_required" ? "attention" : "accent",
					icon: ClipboardCheck,
					headline: state?.pullRequestOutcome
						? FACTORY_PROOF.pullRequestOutcome(state.pullRequestOutcome)
						: card.reasonCode === "review_required"
							? FACTORY_READY.needsReview
							: state?.pullRequestReady
								? FACTORY_READY.markedReady
								: state?.pullRequestUrl
									? FACTORY_READY.draftPr
									: state
										? FACTORY_PHASE_LABEL.ready
										: "Completed",
					stage: "deliver",
				}
			: {
					tone: "working",
					icon: Loader2,
					headline: executionHeadline(task, state),
					stage: executionStage,
					spinning: true,
				};
	if (isReplayReviewQueued(task))
		return {
			tone: "neutral",
			icon: Clock,
			headline: "Plan review queued",
			stage: "plan_review",
		};
	// Nothing runs while scoping waits on the person: no spinner, no timer.
	if (waitingForAnswer)
		return {
			tone: "attention",
			icon: HelpCircle,
			headline: FACTORY_CARD.waitingForAnswer,
			stage: "scope",
			question: true,
		};
	if (designActive) {
		const reviewing = task.factoryDesignProgress?.phase === "reviewing";
		return {
			tone: "working",
			icon: Loader2,
			headline: reviewing
				? FACTORY_ACTIVITY.checkingPlan
				: FACTORY_ACTIVITY.scoping,
			stage: reviewing ? "plan_review" : "scope",
			spinning: true,
		};
	}
	const awaitingStart = factoryAwaitingStart(task, {
		autoProgress,
		designActive,
		approvalReason,
	});
	const scopingWait = factoryScopingWait(task);
	if (scopingWait === "held")
		return {
			tone: "neutral",
			icon: PauseCircle,
			headline: FACTORY_ACTIVITY.onHold,
			stage: "scope",
			notStarted: awaitingStart,
		};
	if (scopingWait === "queued")
		return {
			tone: "neutral",
			icon: Clock,
			headline: FACTORY_ACTIVITY.waitingToStart,
			stage: "scope",
		};
	// No plan for its revision, not queued, not held and not scoping: it
	// will not start on its own. Activity calls it "Not started" too.
	if (awaitingStart)
		return {
			tone: "neutral",
			icon: PlayCircle,
			headline: FACTORY_RECOVERY.notStarted,
			stage: "scope",
			notStarted: true,
		};
	if (autoProgress)
		return task.status === "pending_approval" &&
			task.factoryDesignProgress?.revision === task.revision &&
			task.factoryDesignProgress.phase === "complete"
			? {
					tone: "working",
					icon: Loader2,
					headline: "Approving plan",
					stage: "approve",
					spinning: true,
				}
			: {
					tone: task.status === "approved" ? "working" : "neutral",
					icon: Clock,
					headline:
						task.status === "approved"
							? FACTORY_ACTIVITY.waitingToBuild
							: FACTORY_ACTIVITY.waitingToStart,
					stage: task.status === "approved" ? "build" : "scope",
				};
	if (task.status === "approved")
		return {
			tone: "neutral",
			icon: Clock,
			headline: "Approved · waiting to build",
			stage: "build",
		};
	if (approvalReason)
		return {
			tone: "attention",
			icon: PencilLine,
			headline: FACTORY_ACTIVITY.planNotReady,
			stage:
				task.factoryDesignProgress?.revision === task.revision
					? "plan_review"
					: "scope",
		};
	// A brief nobody scoped yet: approving runs it as written, or scoping
	// plans it first. Both are on the card; neither has happened.
	return task.factoryDesignProgress?.revision !== task.revision
		? {
				tone: "neutral",
				icon: PlayCircle,
				headline: FACTORY_RECOVERY.notStarted,
				stage: "scope",
				unscoped: true,
			}
		: {
				tone: "accent",
				icon: ClipboardCheck,
				headline: "Plan ready for your approval",
				stage: "approve",
			};
}

/** How scoping ran when the request came with its plan, or null. */
export function factoryScopeRouteLine(task: AgendaTaskRecord): string | null {
	const progress =
		task.factoryDesignProgress?.revision === task.revision
			? task.factoryDesignProgress
			: undefined;
	const route = progress?.route;
	if (!route) return null;
	if (route.scoping === "designer")
		return FACTORY_SCOPE_ROUTE.notUsed(
			route.reason ?? "it did not pass the quick check",
		);
	if (progress.phase !== "complete") return FACTORY_SCOPE_ROUTE.checking;
	// `checks` (no model) is only on cards scoped before every supplied plan got the model check.
	return route.sweep === "checks"
		? FACTORY_SCOPE_ROUTE.codeChecked
		: FACTORY_SCOPE_ROUTE.modelChecked;
}

/** The one sentence under the headline that says what happens next. */
function nextActionSentence({
	task,
	state,
	summary,
	executionTask,
	runs,
	openFindings,
	failure,
	autoProgress,
	reviewRequired,
	accept,
	delivery,
	approvalReason,
	waitingFor,
}: {
	task: AgendaTaskRecord;
	state: FactoryRunState | undefined;
	summary: Summary;
	/** The earlier parts a waiting part needs merged, by short id. */
	waitingFor?: string[];
	executionTask: boolean;
	runs: readonly FactoryRetryRun[] | undefined;
	openFindings: number | undefined;
	failure:
		| { onRetry?: () => void; planFault?: boolean; planFaultStopped?: boolean }
		| undefined;
	autoProgress: boolean;
	reviewRequired: { reason: string } | undefined;
	accept: { reason?: string } | undefined;
	delivery: { pullRequestUrl?: string; branch?: string } | undefined;
	approvalReason: string | null;
}): string | null {
	if (task.archivedAt) return "Restore this task to continue.";
	if (task.status === "cancelled" || task.status === "expired")
		return "This task is closed. Create a new task for further changes.";
	if (summary.parent) return FACTORY_SPLIT.parentNext;
	if (summary.breakdown) return FACTORY_SPLIT.approvalNext;
	if (summary.waitingPart && waitingFor?.length)
		return FACTORY_SPLIT.waitingNext(waitingFor);
	if (summary.startAnyway) return FACTORY_SPLIT.unmergedNext;
	if (state?.humanApproval) return FACTORY_CARD_ACTION.reviewed;
	if (openFindings !== undefined)
		return FACTORY_OPEN_FINDINGS.next(openFindings);
	if (
		currentFactoryConclusion(task) &&
		task.status !== "in_progress" &&
		task.status !== "completed"
	)
		return "Dismiss this card, or revise the brief to build anyway.";
	if (executionTask && factoryAutoRetrying(task, state, runs))
		return "The run failed and is retrying once on its own. You are asked only if the retry also fails.";
	if (summary.stopped) {
		if (failure?.planFaultStopped) return FACTORY_RECOVERY.planFaultStopped;
		// Try again beside the headline says it; Edit plan is in More.
		if (failure?.onRetry)
			return failure.planFault ? FACTORY_CARD.planFaultNext : null;
		return "Check the details below before choosing the next step.";
	}
	if (task.factory?.hold === true)
		return "This card is on hold. Start it to begin scoping.";
	if (summary.notStarted) return FACTORY_NOT_STARTED.detail;
	// The question below says what it waits for.
	if (summary.question) return null;
	if (summary.rule) return FACTORY_CARD.ruleNext;
	if (summary.unscoped) return FACTORY_CARD.unscopedNext;
	// The headline says it is moving on its own.
	if (autoProgress) return null;
	if (task.status === "in_progress") return FACTORY_CARD.buildingNext;
	if (reviewRequired) return factoryReviewRequest(reviewRequired.reason);
	if (task.status === "completed") {
		if (accept?.reason) return accept.reason;
		// A merged or closed PR is decided; the headline says how.
		if (delivery?.pullRequestUrl)
			return state?.pullRequestOutcome ? null : FACTORY_CARD_ACTION.deliveredPr;
		if (delivery?.branch)
			return FACTORY_CARD_ACTION.deliveredBranch(delivery.branch);
		return "Review the changes, checks and reports below.";
	}
	// Core's reason when automatic approval left the plan for the user.
	return (
		approvalReason ??
		(factoryAutoApprovalWaiting(task) ||
			"Review the saved brief and checks, then approve execution.")
	);
}

/**
 * "Related: F12, F15": the cards Factory's duplicate check linked when this
 * one was filed. The record keeps their task ids, so their short ids are read.
 */
function FactoryRelatedCards({
	taskIds,
	onOpenCard,
}: {
	taskIds: readonly string[];
	onOpenCard?: (taskId: string) => void;
}) {
	const ids = taskIds.join(" ");
	const [shortIds, setShortIds] = useState<Record<string, string>>({});
	useEffect(() => {
		let current = true;
		void Promise.all(
			ids.split(" ").map(async (taskId) => {
				const reply = await desktopClient
					.invoke<{ task?: AgendaTaskRecord }>("task.get", {
						taskId,
						allWorkspaces: true,
					})
					.catch(() => undefined);
				const shortId = reply?.task ? factoryShortId(reply.task) : undefined;
				return shortId ? [[taskId, shortId] as const] : [];
			}),
		).then((entries) => {
			if (current) setShortIds(Object.fromEntries(entries.flat()));
		});
		return () => {
			current = false;
		};
	}, [ids]);
	// A card that cannot be read (deleted, or not yet loaded) is left out.
	const shown = taskIds.filter((taskId) => shortIds[taskId]);
	if (!shown.length) return null;
	return (
		<span className="flex items-center gap-1" data-factory-related>
			{FACTORY_DUPLICATES.related}
			{shown.map((taskId, index) => {
				const label = shortIds[taskId] as string;
				return (
					<span key={taskId}>
						{onOpenCard ? (
							<Button
								variant="link"
								className="h-auto p-0 text-xs"
								aria-label={FACTORY_DUPLICATES.openRelated(label)}
								onClick={() => onOpenCard(taskId)}
							>
								{label}
							</Button>
						) : (
							label
						)}
						{index < shown.length - 1 ? "," : null}
					</span>
				);
			})}
		</span>
	);
}

/** "Also requested 2 times" on a card later filings were matched to. */
function FactoryAlsoRequested({ task }: { task: AgendaTaskRecord }) {
	const reports = task.factoryDuplicateReports;
	if (!reports?.count) return null;
	const latest = reports.recent.at(-1)?.at;
	const when = latest ? new Date(latest) : undefined;
	return (
		<span
			data-factory-also-requested
			title={
				when && Number.isFinite(when.getTime())
					? FACTORY_DUPLICATES.lastRequested(when.toLocaleString())
					: undefined
			}
		>
			{FACTORY_DUPLICATES.alsoRequested(reports.count)}
		</span>
	);
}

export function FactoryTaskHeader({
	part,
	task,
	busy,
	designActive,
	state,
	approvalReason,
	autoProgress = false,
	onBack,
	onArchive,
	onDelete,
	onStop,
	live,
	failure,
	onStart,
	runs,
	onFixFindings,
	accept,
	delivery,
	onEditPlan,
	onRate,
	findingsShownElsewhere = false,
	waitingForAnswer = false,
	onReviewRule,
	onOpenCard,
	split,
	onStartAnyway,
}: {
	/**
	 * The card page shows the header in two places: the title row (id,
	 * title, repository, More) across the card, and the status at the top
	 * of its main column. Without `part`, both, stacked.
	 */
	part?: "title" | "status";
	task: AgendaTaskRecord;
	busy: boolean;
	designActive: boolean;
	state: FactoryRunState | undefined;
	approvalReason: string | null;
	/** Hands-off work that is moving on its own, with no decision pending. */
	autoProgress?: boolean;
	onBack: () => void;
	onArchive: () => void;
	onDelete: () => void;
	/** Cancels running work or scoping; confirmed first. */
	onStop?: () => void;
	/** Running role sessions, for the live line. The Agents tab lists them all. */
	live?: {
		sessions: FactoryLiveSession[];
		activity?: FactoryLiveActivity;
		waiting?: string;
	};
	/** A stopped card: the reason and its next actions. */
	failure?: {
		reason?: string;
		onRetry?: () => void;
		/** The plan's checks are at fault: Try again sends it back to scoping. */
		planFault?: boolean;
		/** Factory already re-scoped once; only editing the plan fixes it. */
		planFaultStopped?: boolean;
	};
	/** Starts scoping a card nothing else will start. */
	onStart?: () => void;
	/**
	 * The card's runs, so only the first run after the automatic retry was
	 * scheduled reads as retrying, not a later manual Try again.
	 */
	runs?: readonly FactoryRetryRun[];
	/** Retries a run left at its repair limit with its draft PR open. */
	onFixFindings?: () => void;
	/**
	 * A delivered result waiting for the user's review: Accept is the one
	 * primary action. It records the review (the stamp) only. `reason` is why
	 * Factory asks, shown beside it.
	 */
	accept?: { onAccept: () => void; disabled?: boolean; reason?: string };
	/**
	 * A delivered result: the header's primary action opens its draft PR, or
	 * shows its changes when there is no PR.
	 */
	delivery?: {
		pullRequestUrl?: string;
		branch?: string;
		onViewChanges?: () => void;
	};
	/**
	 * Opens the plan for editing: in More, or the stopped card's one action
	 * when only editing fixes it (no Try again).
	 */
	onEditPlan?: () => void;
	/** A delivered card: opens and focuses its feedback box. */
	onRate?: () => void;
	/** The card's artifact panel lists the open findings; keep the actions. */
	findingsShownElsewhere?: boolean;
	/** Scoping asked a question that is still unanswered. */
	waitingForAnswer?: boolean;
	/** A proposed rule waits: brings it into view on the card. */
	onReviewRule?: () => void;
	/** Opens another card (a related card's link). */
	onOpenCard?: (taskId: string) => void;
	/** A split's parent or part: its links, parent and earlier parts. */
	split?: FactorySplitContext;
	/** A part whose earlier part will never merge starts now. */
	onStartAnyway?: () => void;
}) {
	const [deleting, setDeleting] = useState(false);
	const [confirming, setConfirming] = useState<"stop" | "archive" | null>(null);
	// Rate opens the feedback box once the menu has closed, so the menu's
	// focus return to More does not take focus from the box.
	const rating = useRef(false);
	const executionTask =
		task.status === "in_progress" ||
		task.status === "completed" ||
		task.status === "failed";
	const runState = executionTask ? state : undefined;
	const reviewRequired =
		runState?.phase === "ready" &&
		task.status === "completed" &&
		!runState.humanApproval &&
		runState.humanReview?.required
			? runState.humanReview
			: undefined;
	const openFindings = factoryOpenFindings(task, runState);
	const stationOutcome = runState
		? {
				...runState,
				activeSessions: activeFactorySessions(runState.attempts),
			}
		: undefined;
	const links = split?.links;
	const card = factoryCardState(factoryCardInput(task, stationOutcome, links));
	const summary = summarize(
		task,
		runState,
		designActive,
		approvalReason,
		autoProgress,
		runs,
		openFindings?.findings.length,
		failure?.planFaultStopped
			? "stopped"
			: failure?.planFault
				? "retry"
				: undefined,
		card,
		waitingForAnswer,
		links?.dependency?.state === "unavailable"
			? links.dependency.reason
			: undefined,
	);
	// Where the card is on the line, in the home's vocabulary and component.
	const stations =
		summary.stage === undefined
			? undefined
			: factoryCardStations(factoryStation(task, stationOutcome, { links }));
	const nextAction = nextActionSentence({
		task,
		state,
		summary,
		executionTask,
		runs,
		openFindings: openFindings?.findings.length,
		failure,
		autoProgress,
		reviewRequired,
		accept,
		delivery,
		approvalReason,
		waitingFor: card.waitingFor,
	});
	const source = task.factory?.sourceIssue;
	const liveSessions = live?.sessions ?? [];
	const showLive =
		!summary.stopped &&
		!summary.question &&
		(liveSessions.length > 0 || Boolean(live?.waiting));
	const stopping = task.status === "in_progress" || designActive;
	// The headline already says how it stopped; the reason says why.
	// A repair-limit stop names the finding it could not clear.
	const failureReason = withoutHeadlineLead(
		factoryRepairLimitReason(task.error ?? state?.error) ?? failure?.reason,
		summary.headline,
	);
	const scopeRoute = factoryScopeRouteLine(task);
	const editPlanPrimary = summary.stopped && !failure?.onRetry;
	const editPlanInMore = editPlanPrimary ? undefined : onEditPlan;
	const reviewState = Boolean(accept) && !summary.stopped;
	// The live line says what is running; the generic note would repeat it.
	// On a card waiting for review, Factory's reason sits beside Accept.
	const nextLine =
		(showLive && nextAction === FACTORY_CARD.buildingNext) ||
		(reviewState && accept?.reason)
			? null
			: nextAction;
	const titleRow = (
		<>
			<div className="flex @min-[960px]/factory:hidden">
				{/* Beside the card rail, its Factory header is the way back. */}
				<Button
					variant="ghost"
					size="sm"
					className="-ml-2 text-muted-foreground"
					data-factory-back
					onClick={onBack}
					disabled={busy}
				>
					<ArrowLeft className="mr-1 size-4" /> Back to Factory
				</Button>
			</div>
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					{/* The id leads the title's first line; the title wraps after it. */}
					<h1 className="break-words text-lg leading-snug font-semibold">
						<FactoryIdChip
							task={task}
							className="mr-2 inline-block align-middle text-xs leading-5"
						/>
						{task.title}
					</h1>
					{isFactoryRuleCard(task) ? (
						<p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
							<FactoryRuleBadge />
							<span>{FACTORY_RULE_CARD.explanation}</span>
						</p>
					) : null}
					<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
						<span
							className="flex min-w-0 items-center gap-1.5"
							title={task.workspaceRoot}
						>
							<FolderGit2 className="size-3.5 shrink-0" />
							<span className="truncate font-medium text-foreground">
								{basenamePath(task.workspaceRoot)}
							</span>
							<span className="sr-only">{task.workspaceRoot}</span>
						</span>
						{split?.parent ? (
							<FactoryParentLink parent={split.parent} onOpen={onOpenCard} />
						) : null}
						<FactoryPriorityControl task={task} />
						{source ? (
							<Button
								variant="link"
								className="h-auto p-0 text-xs"
								onClick={() => void openExternalUrl(source.url)}
							>
								{source.provider === "github" ? "GitHub issue" : "Linear issue"}{" "}
								· {source.id}
								<ArrowUpRight className="ml-1 size-3" />
							</Button>
						) : null}
						{task.factory?.relatedTo?.length ? (
							<FactoryRelatedCards
								taskIds={task.factory.relatedTo}
								onOpenCard={onOpenCard}
							/>
						) : null}
						<FactoryAlsoRequested task={task} />
					</div>
				</div>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" size="sm" disabled={busy}>
							<MoreHorizontal className="mr-1 size-4" /> More
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="end"
						onCloseAutoFocus={(event) => {
							if (!rating.current) return;
							rating.current = false;
							event.preventDefault();
							onRate?.();
						}}
					>
						{onRate ? (
							<DropdownMenuItem
								onSelect={() => {
									rating.current = true;
								}}
							>
								{FACTORY_CARD_ACTION.rate}
							</DropdownMenuItem>
						) : null}
						{editPlanInMore ? (
							<DropdownMenuItem onSelect={editPlanInMore}>
								{FACTORY_CARD_ACTION.editPlan}
							</DropdownMenuItem>
						) : null}
						{onStop ? (
							<DropdownMenuItem onSelect={() => setConfirming("stop")}>
								{summary.startAnyway
									? FACTORY_SPLIT.cancelPart
									: "Stop this work…"}
							</DropdownMenuItem>
						) : null}
						<DropdownMenuItem
							onSelect={() =>
								!task.archivedAt && stopping
									? setConfirming("archive")
									: onArchive()
							}
						>
							{task.archivedAt
								? "Restore"
								: stopping
									? "Cancel and archive…"
									: "Archive"}
						</DropdownMenuItem>
						<DropdownMenuItem
							variant="destructive"
							onSelect={() => setDeleting(true)}
						>
							Delete…
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<AlertDialog
				open={confirming !== null}
				onOpenChange={(open) => {
					if (!open) setConfirming(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{confirming === "archive"
								? "Stop this work and archive it?"
								: summary.startAnyway
									? FACTORY_SPLIT.cancelPartTitle
									: "Stop this work?"}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{summary.startAnyway && confirming === "stop"
								? FACTORY_SPLIT.cancelPartDescription
								: "The running agents stop now. Changes made so far stay on the feature branch, and you can start again later."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							{summary.startAnyway && confirming === "stop"
								? FACTORY_SPLIT.keepPart
								: "Keep working"}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={() =>
								confirming === "archive" ? onArchive() : onStop?.()
							}
						>
							{confirming === "archive"
								? "Stop and archive"
								: summary.startAnyway
									? FACTORY_SPLIT.cancelPartConfirm
									: "Stop work"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<AlertDialog open={deleting} onOpenChange={setDeleting}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this task permanently?</AlertDialogTitle>
						<AlertDialogDescription>
							This stops any active work and deletes the task and its run
							history. Files, branches, and session transcripts are kept. You
							cannot undo this.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep task</AlertDialogCancel>
						<AlertDialogAction onClick={onDelete}>
							Delete permanently
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
	const status = (
		<section
			aria-label="Task progress"
			className={cn("rounded-lg border", toneSurface(summary.tone))}
		>
			<div className="flex flex-col gap-3 px-5 py-4 @max-[30rem]/header:px-4 @max-[30rem]/header:py-3 @min-[30rem]/header:flex-row @min-[30rem]/header:items-start">
				<div className="flex min-w-0 flex-1 items-start gap-3">
					<summary.icon
						className={cn(
							"mt-0.5 size-5 shrink-0",
							toneText(summary.tone),
							summary.spinning && "animate-spin motion-reduce:animate-none",
						)}
					/>
					<div className="min-w-0 flex-1 space-y-1">
						<strong className="block text-sm font-semibold">
							{summary.headline}
						</strong>
						{scopeRoute ? (
							<p
								className="text-xs text-muted-foreground"
								data-testid="factory-scope-route"
							>
								{scopeRoute}
							</p>
						) : null}
						{showLive ? (
							<FactoryLiveLine
								sessions={liveSessions}
								activity={live?.activity}
								waiting={live?.waiting}
								showOthers={false}
							/>
						) : null}
						{summary.stopped && failureReason ? (
							<p
								className="whitespace-pre-line break-words text-sm text-foreground"
								data-testid="factory-failure-reason"
							>
								{failureReason}
							</p>
						) : null}
						{nextLine ? (
							<p className="text-sm text-muted-foreground">{nextLine}</p>
						) : null}
						{summary.waitingPart || summary.startAnyway
							? split?.waitingOn?.flatMap((other) =>
									other.pullRequestUrl ? (
										<Button
											key={other.taskId}
											variant="link"
											className="mr-3 h-auto p-0 text-sm has-[>svg]:px-0"
											onClick={() =>
												other.pullRequestUrl &&
												void openExternalUrl(other.pullRequestUrl)
											}
										>
											{FACTORY_SPLIT.openPullRequest(
												other.shortId ?? other.title,
											)}
											<ArrowUpRight className="ml-1 size-3" />
										</Button>
									) : (
										[]
									),
								)
							: null}
						{openFindings && summary.warning && !findingsShownElsewhere ? (
							<FactoryFindingList findings={openFindings.findings} />
						) : null}
						<CardActions
							busy={busy}
							summary={summary}
							onRetry={failure?.onRetry}
							retryLabel={
								factoryScopingStopped(task)
									? FACTORY_CARD_ACTION.tryScopingAgain
									: FACTORY_CARD_ACTION.tryAgain
							}
							onEditPlan={onEditPlan}
							onStart={onStart}
							startLabel={
								task.factory?.hold === true
									? FACTORY_RECOVERY.start
									: FACTORY_CARD.startScoping
							}
							accept={reviewState ? accept : undefined}
							onFixFindings={onFixFindings}
							pullRequestUrl={
								openFindings?.pullRequestUrl ??
								(reviewState || delivery
									? (delivery?.pullRequestUrl ?? state?.pullRequestUrl)
									: undefined)
							}
							pullRequestLabel={factoryPullRequestActionLabel(state)}
							delivery={delivery}
							onReviewRule={summary.rule ? onReviewRule : undefined}
							onStartAnyway={summary.startAnyway ? onStartAnyway : undefined}
						/>
					</div>
				</div>
			</div>
			{stations ? (
				<div
					className="border-t border-inherit bg-background/60 px-5 py-3 text-xs @max-[30rem]/header:px-4"
					data-testid="factory-card-stations"
				>
					<FactoryStationLine
						stations={stations}
						aria-label={FACTORY_CARD_ACTION.stationLine}
					/>
				</div>
			) : null}
		</section>
	);
	if (part === "title")
		return <header className="@container/header space-y-3">{titleRow}</header>;
	if (part === "status")
		return <div className="@container/header">{status}</div>;
	return (
		<header className="@container/header space-y-5 @max-[30rem]/header:space-y-4">
			{titleRow}
			{status}
		</header>
	);
}

/**
 * The header's actions: ONE primary action per state, at most one or two
 * quiet secondary ones. Working cards have none (the Agents tab is the
 * content); Needs review: Accept, with Factory's reason beside it and "Have
 * Factory fix" when there are findings; Stopped: Try again (Edit plan is in
 * More), or Edit plan when only editing fixes it; Not started: Start scoping;
 * Delivered: Open draft PR (Open PR once it is merged, closed or marked
 * ready), or View changes when there is no PR.
 */
/**
 * The card's priority: a button with its level, opening a radio menu. A
 * choice shows at once and returns to the saved level, with a note, if the
 * Hub refuses it. It changes nothing else, so it is offered in every state.
 */
function FactoryPriorityControl({ task }: { task: AgendaTaskRecord }) {
	const saved = task.factoryPriority;
	// The choice the task does not carry yet, over the value it replaces: a
	// newer saved value (this choice arriving, or anyone's) supersedes it.
	const [pending, setPending] = useState<{
		level: FactoryPriority | null;
		over: string | undefined;
	}>();
	const [failed, setFailed] = useState(false);
	const latest = useRef(0);
	const choosing = pending !== undefined && pending.over === saved?.at;
	const level = choosing
		? pending.level
		: hasFactoryPriority(saved)
			? saved.level
			: null;
	const label = FACTORY_PRIORITY_LABEL[level ?? "none"];
	const choose = async (value: string) => {
		const next = value === "none" ? null : (value as FactoryPriority);
		if (next === level) return;
		const request = ++latest.current;
		setPending({ level: next, over: saved?.at });
		setFailed(false);
		try {
			await desktopClient.invoke("task.factory.priority", {
				taskId: task.taskId,
				priority: next,
				allWorkspaces: true,
			});
		} catch {
			if (request !== latest.current) return;
			setPending(undefined);
			setFailed(true);
		}
	};
	return (
		<span className="flex min-w-0 items-center gap-2.5">
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="xs"
						data-factory-priority-control
						aria-label={`${FACTORY_PRIORITY.menu}: ${label}`}
						className="-mx-1.5 h-6 gap-1.5 px-1.5 font-normal text-muted-foreground hover:text-foreground"
					>
						<FactoryPriorityGlyph level={level ?? "none"} />
						{label}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start">
					<DropdownMenuRadioGroup
						value={level ?? "none"}
						onValueChange={(value) => void choose(value)}
					>
						{(["none", ...FACTORY_PRIORITIES] as const).map((option) => (
							<DropdownMenuRadioItem key={option} value={option}>
								<FactoryPriorityGlyph
									level={option}
									className="text-muted-foreground"
								/>
								{FACTORY_PRIORITY_LABEL[option]}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			{failed ? (
				<span role="alert" className="text-destructive">
					{FACTORY_PRIORITY.saveFailed}
				</span>
			) : !choosing && saved?.by === "scoper" ? (
				<span className="min-w-0 truncate" title={saved.reason}>
					{FACTORY_PRIORITY.estimated(saved.reason)}
				</span>
			) : null}
		</span>
	);
}

function CardActions({
	busy,
	summary,
	onRetry,
	retryLabel,
	onEditPlan,
	onStart,
	startLabel,
	accept,
	onFixFindings,
	pullRequestUrl,
	pullRequestLabel,
	delivery,
	onReviewRule,
	onStartAnyway,
}: {
	busy: boolean;
	summary: Summary;
	onRetry?: () => void;
	retryLabel: string;
	onEditPlan?: () => void;
	onStart?: () => void;
	startLabel: string;
	accept?: { onAccept: () => void; disabled?: boolean; reason?: string };
	onFixFindings?: () => void;
	pullRequestUrl?: string;
	pullRequestLabel: string;
	delivery?: { onViewChanges?: () => void };
	onReviewRule?: () => void;
	onStartAnyway?: () => void;
}) {
	const openPr = (primary: boolean) =>
		pullRequestUrl ? (
			<Button
				size="sm"
				variant={primary ? "default" : "outline"}
				onClick={() => void openExternalUrl(pullRequestUrl)}
			>
				{pullRequestLabel}
				<ArrowUpRight className="ml-1.5 size-3" />
			</Button>
		) : null;
	let primary: ReactNode = null;
	const secondary: ReactNode[] = [];
	let beside: string | undefined;
	if (summary.stopped && onRetry)
		primary = (
			<Button size="sm" disabled={busy} onClick={onRetry}>
				{retryLabel}
			</Button>
		);
	else if (summary.stopped && onEditPlan)
		primary = (
			<Button size="sm" disabled={busy} onClick={onEditPlan}>
				{FACTORY_CARD_ACTION.editPlan}
			</Button>
		);
	else if (accept) {
		primary = (
			<Button
				size="sm"
				disabled={busy || accept.disabled}
				title={FACTORY_CARD_ACTION.acceptHint}
				onClick={accept.onAccept}
			>
				<CheckCircle2 className="mr-1.5 size-3.5" />
				{FACTORY_CARD_ACTION.accept}
			</Button>
		);
		beside = accept.reason;
		if (onFixFindings)
			secondary.push(
				<Button
					key="fix"
					size="sm"
					variant="outline"
					disabled={busy}
					onClick={onFixFindings}
				>
					{FACTORY_CARD_ACTION.haveFactoryFix}
				</Button>,
			);
		const pr = openPr(false);
		if (pr) secondary.push(<span key="pr">{pr}</span>);
	} else if (onReviewRule) {
		// The rule is the decision; the PR stays one click away.
		primary = (
			<Button size="sm" onClick={onReviewRule}>
				{FACTORY_CARD.reviewRule}
			</Button>
		);
		const pr = openPr(false);
		if (pr) secondary.push(<span key="pr">{pr}</span>);
	} else if (onStartAnyway)
		primary = (
			<Button size="sm" disabled={busy} onClick={onStartAnyway}>
				{FACTORY_SPLIT.startAnyway}
			</Button>
		);
	else if (summary.notStarted && onStart)
		primary = (
			<Button size="sm" disabled={busy} onClick={onStart}>
				{startLabel}
			</Button>
		);
	else if (pullRequestUrl) {
		primary = openPr(true);
		if (onFixFindings)
			secondary.push(
				<Button
					key="fix"
					size="sm"
					variant="outline"
					disabled={busy}
					onClick={onFixFindings}
				>
					{FACTORY_CARD_ACTION.haveFactoryFix}
				</Button>,
			);
	} else if (delivery?.onViewChanges)
		primary = (
			<Button size="sm" onClick={delivery.onViewChanges}>
				{FACTORY_CARD_ACTION.viewChanges}
			</Button>
		);
	if (!primary) return null;
	return (
		<div
			className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-2"
			data-testid="factory-card-actions"
		>
			{/* Why Factory asks comes first, then what to do about it. */}
			{beside ? (
				<p
					className="basis-full text-sm text-muted-foreground"
					data-testid="factory-review-reason"
				>
					{beside}
				</p>
			) : null}
			{primary}
			{secondary}
		</div>
	);
}

/** Characters of a finding shown before its full text is opened. */
const FINDING_LINE_CHARS = 160;

/**
 * Open review findings as short lines, with the full text behind a
 * disclosure. Paths are already repository-relative.
 */
export function FactoryFindingList({
	findings,
}: {
	findings: readonly string[];
}) {
	const short = (finding: string) => {
		const line = finding.trim().split("\n", 1)[0]?.trim() ?? "";
		return line.length > FINDING_LINE_CHARS
			? `${line.slice(0, FINDING_LINE_CHARS - 1).trimEnd()}…`
			: line;
	};
	const truncated = findings.some(
		(finding) => short(finding) !== finding.trim(),
	);
	return (
		<div className="space-y-1 pt-1" data-testid="factory-open-findings">
			<ul className="list-disc space-y-0.5 pl-5 text-sm">
				{findings.map((finding, index) => (
					<li key={`${index}-${finding}`} className="break-words">
						{short(finding)}
					</li>
				))}
			</ul>
			{truncated ? (
				<details className="text-xs">
					<summary className="cursor-pointer text-muted-foreground">
						{FACTORY_OPEN_FINDINGS.fullText}
					</summary>
					<ul className="mt-1 max-h-64 space-y-2 overflow-auto rounded bg-muted/40 p-3">
						{findings.map((finding, index) => (
							<li
								key={`${index}-${finding}`}
								className="whitespace-pre-wrap break-words"
							>
								{finding}
							</li>
						))}
					</ul>
				</details>
			) : null}
		</div>
	);
}

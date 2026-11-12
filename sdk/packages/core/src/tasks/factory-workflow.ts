import type {
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	FactoryAcceptanceCriterion,
	FactoryAppEnvironment,
	FactoryArtifact,
	FactoryCandidate,
	FactoryCheckResult,
	FactoryRepositoryStage,
	FactoryReview,
	FactoryRunState,
	FactoryStageResult,
	FactoryTaskConfig,
	FactoryWorkspace,
} from "@cline/shared";
import {
	DEFAULT_FACTORY_AGENTS,
	evaluateFactoryAcceptance,
	FACTORY_SECURITY_FINDINGS_REVIEW,
	FACTORY_UNRESOLVED_FINDINGS_REVIEW,
	FACTORY_VERIFICATION_PROFILE_PATH,
	factoryAcceptanceConfigurationFindings,
	factoryDiffSize,
	factoryIndependentReview,
	factoryPullRequestReadyAllowed,
	factoryRecordedReviewIndependence,
	factoryRepositoryRelative,
	factoryReviewFindings,
	factoryReviewSize,
	factoryReviewSizeEscalation,
	factoryStampRequirement,
} from "@cline/shared";
import type {
	AgendaTaskRuntime,
	AgendaTaskRuntimeResult,
} from "./agenda-task-manager";
import { parseFactoryReview, parseFactoryVerification } from "./factory-agents";
import {
	FactoryAppEnvironmentError,
	type FactoryAppEnvironmentHandle,
	type FactoryAppEnvironmentStage,
	startFactoryAppEnvironment,
	stopFactoryAppEnvironment,
} from "./factory-app-environment";
import {
	FactoryDecisionError,
	FactoryPlanConfigurationError,
	FactoryVerificationProfileError,
} from "./factory-errors";
import {
	FACTORY_BUILDER_SUMMARY_INSTRUCTION,
	factoryPullRequestDescription,
	factoryPullRequestTitle,
} from "./factory-evidence";
import {
	assertFactoryCandidate,
	captureFactoryArtifactVersions,
	checkpointFactoryWorkspace,
	collectFactoryArtifacts,
	factoryCheckConfigurationFindings,
	factoryWorkspaceChanges,
	finishFactoryIntegration,
	integrateFactoryCommit,
	markFactoryPullRequestReady,
	prepareFactoryWorkspace,
	publishFactoryPullRequest,
	readFactoryPullRequestContext,
	resolveFactoryPullRequestBase,
	restoreFactoryWorktree,
	updateFactoryPullRequestBody,
	verifyFactoryChecks,
} from "./factory-local";
import {
	FACTORY_RULE_NOMINATION_INSTRUCTION,
	formatFactoryKnownRuleKeys,
	isFactoryRuleCard,
} from "./factory-repo-rules";

import {
	createFactorySessionRunner,
	FactoryPersistenceError,
} from "./factory-session";
import {
	FactoryStageError,
	factoryAgentStageAgent,
	factoryAgentStageInput,
	factoryChangedPathsBetween,
	factoryReadStageOutcome,
	factoryStageFindings,
	factoryStageResultBase,
	factoryStageSkipReason,
	formatFactoryStageResults,
	isFactoryRetryLimitError,
	runFactoryCommandStage,
} from "./factory-stages";
import {
	formatFactoryVerificationProfileForFinalReviewer,
	writeFactoryVerificationProfile,
} from "./factory-verification-profile";

export type FactoryWorkflowInput = {
	task: AgendaTaskRecord;
	run: AgendaTaskRunRecord;
	state: FactoryRunState;
	runtime: AgendaTaskRuntime;
	storageDir: string;
	signal: AbortSignal;
	save: (state: FactoryRunState) => void;
	sessionStarted: (sessionId: string) => void;
	repairInstructions?: string;
	/**
	 * Whether the task's frozen verification profile hash already passed a
	 * preflight (the trust store's provenAt). Unset counts as unproven, so a
	 * run with a profile preflights it before its first builder session.
	 */
	verificationProfileProven?: boolean;
	/** Called once when this run's preflight proves the profile hash; failures are ignored. */
	onVerificationProfileProven?: (hash: string) => Promise<void>;
	/** Rule keys earlier reviews in this workspace used, shown to final reviewers of non-rule cards. */
	knownRuleKeys?: readonly string[];
};

/**
 * Finding text that may concern security: a run stopped with such a finding
 * keeps its work local instead of publishing it as a draft PR. Deliberately
 * broad; a false match only means a person publishes it.
 */
const FACTORY_SECURITY_FINDING =
	/secret|credential|token|password|passphrase|private[\s_-]?key|vulnerab|injection|\bCVE\b/i;

/** `diff` without the sections of the file at `file` (a repository-relative path). */
function withoutDiffFile(diff: string, file: string): string {
	return diff
		.split(/^(?=diff --git )/m)
		.filter(
			(section) => !section.startsWith(`diff --git a/${file} b/${file}\n`),
		)
		.join("");
}

/** Characters of one unresolved finding kept in run state. */
const UNRESOLVED_FINDING_CHARS = 2_000;

/** verifierEnvironment key prefix of a profile preflight, so a crash leftover runs the profile's cleanup. */
const PREFLIGHT_KEY_PREFIX = "verification-profile:";
/** Characters of preflight failure detail kept in run state: the head (the reason) and the log tail. */
const PREFLIGHT_DETAIL_HEAD = 1_000;
const PREFLIGHT_DETAIL_TAIL = 3_000;

function boundedPreflightDetail(detail: string): string {
	return detail.length <= PREFLIGHT_DETAIL_HEAD + PREFLIGHT_DETAIL_TAIL
		? detail
		: `${detail.slice(0, PREFLIGHT_DETAIL_HEAD)}\n[Output omitted.]\n${detail.slice(-PREFLIGHT_DETAIL_TAIL)}`;
}

/** Order-independent identity of a flat app environment. */
function environmentIdentity(
	environment: FactoryAppEnvironment | undefined,
): string | undefined {
	if (!environment) return undefined;
	return JSON.stringify(
		Object.entries(environment)
			.filter(([, value]) => value !== undefined)
			.sort(([a], [b]) => a.localeCompare(b)),
	);
}

type UnmetFactoryAcceptance = { repair: string[]; verify: string[] };

/**
 * Required criteria that did not pass, regardless of any overall verdict.
 * Unverified verifier-owned criteria need fresh verifier evidence for the same
 * candidate; everything else, including check-mapped results, needs a repair
 * after which the approved checks run again.
 */
/** The first line of a finding, bounded for a task error summary. */
function oneLine(text: string, limit = 240): string {
	const line = text.trim().split("\n", 1)[0]?.trim() ?? "";
	return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

/** A one-line reason a check did not pass, from its exit code and output tail. */
export function factoryCheckReason(check: FactoryCheckResult): string {
	const last = check.output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1);
	const exit =
		check.status === "failed"
			? check.exitCode === null
				? "did not exit"
				: `exit ${check.exitCode}`
			: undefined;
	return oneLine(
		factoryRepositoryRelative([exit, last].filter(Boolean).join(": ")) ||
			check.status,
	);
}

export function unmetFactoryAcceptance(
	criteria: FactoryAcceptanceCriterion[] | undefined,
	candidate: Pick<FactoryCandidate, "checks" | "verification">,
): UnmetFactoryAcceptance {
	const unmet: UnmetFactoryAcceptance = { repair: [], verify: [] };
	for (const { criterion, outcome, evidence } of evaluateFactoryAcceptance(
		criteria ?? [],
		candidate,
	)) {
		if (!criterion.required || outcome === "passed") continue;
		(outcome === "unverified" && !criterion.check
			? unmet.verify
			: unmet.repair
		).push(
			`Acceptance criterion "${criterion.id}" (${criterion.text}) ${outcome}: ${evidence ?? "no result was reported"}`,
		);
	}
	return unmet;
}

function hasCodeFindings(
	candidate: FactoryCandidate,
	unmet: UnmetFactoryAcceptance,
): boolean {
	const blocks = (review: FactoryReview, gaps: number) =>
		review.findings.length > 0 ||
		(review.verdict === "changes_requested" && gaps === 0);
	const verification = candidate.verification?.review;
	return (
		unmet.repair.length > 0 ||
		candidate.checks.some((check) => check.status !== "passed") ||
		factoryStageFindings(candidate.stages).length > 0 ||
		candidate.reviews.some(({ review }) =>
			blocks(review, review.coverage?.requiredGaps.length ?? 0),
		) ||
		(verification !== undefined &&
			blocks(
				verification,
				(verification.coverage?.requiredGaps.length ?? 0) + unmet.verify.length,
			))
	);
}

export function retryUnavailableFactoryVerification(
	state: FactoryRunState,
	config: Pick<FactoryTaskConfig, "acceptanceCriteria" | "maxRuntimeRetries">,
): FactoryRunState {
	const candidate = state.candidate;
	if (!candidate) return state;
	const unmet = unmetFactoryAcceptance(config.acceptanceCriteria, candidate);
	if (hasCodeFindings(candidate, unmet)) return state;
	const maxRetries = config.maxRuntimeRetries ?? 2;
	const verifier = [
		...(candidate.verification?.review.coverage?.requiredGaps ?? []),
		...unmet.verify,
	];
	const reviewers = candidate.reviews
		.filter((entry) => entry.review.coverage?.requiredGaps.length)
		.map((entry) => ({
			reviewerIndex: entry.reviewerIndex,
			gaps: entry.review.coverage?.requiredGaps ?? [],
		}));
	if (!verifier.length && !reviewers.length) return state;
	const verificationRetry = (state.verificationRetry ?? 0) + 1;
	if (verificationRetry > maxRetries)
		throw new FactoryDecisionError(
			`Required verification remains unavailable after ${maxRetries} retries: ${[...verifier, ...reviewers.flatMap((entry) => entry.gaps)].join("; ")}. Restore the missing capability or revise the approved verification setup before retrying.`,
		);
	return {
		...state,
		phase: "verifying",
		error: undefined,
		verificationRetry,
		verificationFeedback: { commit: candidate.commit, verifier, reviewers },
		candidate: {
			...candidate,
			reviews: candidate.reviews.filter(
				(entry) => !entry.review.coverage?.requiredGaps.length,
			),
			verification: verifier.length ? undefined : candidate.verification,
		},
		verifierBaseline: verifier.length ? undefined : state.verifierBaseline,
	};
}

export async function runFactoryWorkflow(
	input: FactoryWorkflowInput,
): Promise<AgendaTaskRuntimeResult> {
	const { task, run, signal } = input;
	const config = task.factory;
	if (!config) throw new Error("Factory configuration is required");
	let agents = input.state.agents ?? config.agents ?? DEFAULT_FACTORY_AGENTS;
	let state = input.state;
	const save = (patch: Partial<FactoryRunState>) => {
		signal.throwIfAborted();
		const next = { ...state, ...patch };
		try {
			input.save(next);
		} catch (error) {
			throw new FactoryPersistenceError(
				"Could not persist Factory transition",
				{ cause: error },
			);
		}
		state = next;
	};
	/** Records why the draft PR could not be opened, for the board, then rethrows. */
	const recordPublishFailure = async <T>(publish: () => Promise<T>) => {
		try {
			return await publish();
		} catch (error) {
			if (!signal.aborted)
				save({
					pullRequestError: (error instanceof Error
						? error.message
						: String(error)
					).slice(0, 2_000),
				});
			throw error;
		}
	};
	/** The generated block of the card's PR description for `candidate`. */
	const pullRequestSection = async (candidate: FactoryCandidate) =>
		factoryPullRequestDescription({
			task,
			state,
			candidate,
			context: await readFactoryPullRequestContext({
				workspace: state.workspace,
				candidateCommit: candidate.commit,
				signal,
			}),
		});
	/**
	 * Pushes a candidate that passed verification and review (or stopped with
	 * only review findings) and opens the card's draft PR, or moves the card's
	 * existing PR to it. Nothing reaches the remote before this point. Returns
	 * whether the PR is new, so its description needs no separate update.
	 */
	const publishCandidate = async (
		candidate: FactoryCandidate,
		section: string,
	) => {
		const existed = Boolean(state.pullRequestUrl);
		save({ phase: "publishing" });
		const pullRequestUrl = await recordPublishFailure(() =>
			publishFactoryPullRequest({
				workspace: state.workspace,
				candidateCommit: candidate.commit,
				baseBranch: state.pullRequestBase,
				pullRequestUrl: state.pullRequestUrl,
				title: factoryPullRequestTitle(task),
				body: section,
				signal,
			}),
		);
		save({
			pullRequestUrl,
			pullRequestError: undefined,
			pullRequestWatch: {
				...state.pullRequestWatch,
				headCommit: candidate.commit,
				handledFeedbackIds: state.pullRequestWatch?.handledFeedbackIds ?? [],
			},
			pullRequestChecks: {
				headCommit: candidate.commit,
				status: "unknown",
				checks: [],
			},
		});
		return !existed;
	};
	/** Best-effort description update; returns a note for the outcome when it fails. */
	const describePullRequest = async (url: string, section: string) => {
		try {
			await updateFactoryPullRequestBody({
				workspace: state.workspace,
				url,
				section,
				signal,
			});
			return "";
		} catch (error) {
			if (signal.aborted) throw error;
			return "PR description could not be updated.";
		}
	};
	/** Rounds a person granted by retrying a stop at the limit add to the plan's. */
	const repairLimit = () =>
		config.maxRepairRounds + (state.extraRepairRounds ?? 0);
	/** Recorded finding text with worktree and workspace prefixes removed. */
	const relative = (text: string) =>
		factoryRepositoryRelative(text, [state.workspace.path, task.workspaceRoot]);
	const { execute, refreshUsage } = createFactorySessionRunner({
		...input,
		getState: () => state,
		save,
	});
	const implementationInstructions = `APPROVED BRIEF:\n${task.instructions}\n\nAPPROVED VERIFICATION CHECKS:\n${JSON.stringify(config.checks)}\n\nAPPROVED ACCEPTANCE CRITERIA (a named check or the verifier proves each):\n${JSON.stringify(config.acceptanceCriteria ?? [])}\nEvidence must be generated by these checks in gitignored paths. Do not modify approved checks or acceptance criteria.\n\nImplement only this approved scope. Reuse existing code. Avoid duplicated logic, speculative abstractions, unrelated changes, and comments that narrate code. Do not publish, push, or open a pull request. The factory will run the approved checks and independent review.${state.workspace.baseNote ? ` ${state.workspace.baseNote}` : ""}${agents.verifier ? " Run relevant unit and integration checks while implementing. The configured verifier owns browser/native E2E interaction and evidence capture; leave that execution to the verifier." : ""}`;
	const builderInstructions = () =>
		`${implementationInstructions} ${FACTORY_BUILDER_SUMMARY_INSTRUCTION}${state.repairInstructions ? `\n\nREPAIR FEEDBACK:\n${state.repairInstructions}` : ""}${input.repairInstructions ? `\n\nPR FOLLOW-UP:\n${input.repairInstructions}` : ""}`;
	const integrate = async (workspace: FactoryWorkspace, commit: string) => {
		const prefix = `integration:${workspace.branch}:${commit}:`;
		while (
			(await integrateFactoryCommit({
				workspace,
				commit,
				signal,
				hasRecordedConflictRepair: state.integrationRepairs?.some((repair) =>
					repair.key.startsWith(prefix),
				),
			})) === "conflicted"
		) {
			const repairs = (state.integrationRepairs ?? []).filter((repair) =>
				repair.key.startsWith(prefix),
			);
			const active = repairs.find((repair) => repair.status === "running");
			const key = active?.key ?? `${prefix}${repairs.length}`;
			if (!active) {
				if (state.repairRound >= repairLimit())
					throw new FactoryDecisionError(
						`Repair limit (${repairLimit()}) reached resolving implementation integration`,
					);
				save({
					phase: "repairing",
					repairRound: state.repairRound + 1,
					integrationRepairs: [
						...(state.integrationRepairs ?? []),
						{ key, status: "running" },
					],
				});
			}
			await execute(
				key,
				`Resolve only the pending merge of implementation commit ${commit} within the approved scope. Preserve both units' intended behavior. Inspect the actual conflicted paths, resolve conflict markers and stage the resolution. Do not abort/reset the merge, weaken checks, publish, or push. The factory will checkpoint and independently verify the result.\n\n${implementationInstructions}`,
				agents.implementers[0],
				"builder",
				undefined,
				workspace,
			);
			const resolved = await finishFactoryIntegration({ workspace, signal });
			save({
				integrationRepairs: state.integrationRepairs?.map((repair) =>
					repair.key === key ? { ...repair, status: "checked" } : repair,
				),
			});
			if (resolved) {
				if (
					(await integrateFactoryCommit({ workspace, commit, signal })) !==
					"merged"
				)
					throw new Error(
						"Integration resolution did not retain the implementation commit",
					);
				return;
			}
		}
	};
	const verifierCriteria = (config.acceptanceCriteria ?? []).filter(
		(criterion) => !criterion.check,
	);
	const responseFormat =
		'Return only JSON matching {"verdict":"pass"|"changes_requested","summary":"...","findings":["..."],"coverage":{"static":["..."],"exercised":["..."],"requiredGaps":["..."],"limitations":["..."]}}; pass requires zero findings and zero required coverage gaps. findings contains confirmed code or behavior defects or inadequate approved verification requirements. Required role-owned execution, capability, or evidence gaps belong only in coverage.requiredGaps, never duplicated in findings; put approved optional or excluded scope, and data-conditional checks whose stated prerequisites are absent, in coverage.limitations. Limitations do not replace an unmet mandatory criterion; report that in requiredGaps. coverage.exercised lists only checks or actions you personally executed; inspecting source, test assertions, or recorded output belongs in coverage.static or summary. Never invent evidence or erase a required gap merely to pass. If submit_and_exit is available, put that exact JSON in its summary field. Keep coverage private; never publish it.';
	const profile = config.verificationProfile;
	const forgetEnvironment = () => {
		if (!signal.aborted) return save({ verifierEnvironment: undefined });
		// Best-effort after cancellation; a kept record is stopped again on the next run.
		const next = { ...state, verifierEnvironment: undefined };
		try {
			input.save(next);
			state = next;
		} catch {}
	};
	/** Factory, not the builder, writes the frozen profile, so builder edits to it never ship. */
	const writeProfile = async (workspace: FactoryWorkspace) => {
		if (!profile) return;
		try {
			await writeFactoryVerificationProfile(workspace.path, profile.profile);
		} catch (error) {
			if (error instanceof FactoryVerificationProfileError) throw error;
			throw new FactoryVerificationProfileError(
				"write",
				error instanceof Error ? error.message : String(error),
			);
		}
	};
	/**
	 * Proves an unproven profile before any builder session: setup, start,
	 * healthcheck and stop in the worktree at the base commit, which must stay
	 * clean. A failure belongs to the profile, not a candidate, so the run stops
	 * without a builder round or blind retry.
	 */
	const preflightProfile = async () => {
		if (!profile || input.verificationProfileProven) return;
		const recorded = state.verificationProfile;
		if (recorded?.hash === profile.hash && recorded.preflight === "passed")
			return;
		const key = `${PREFLIGHT_KEY_PREFIX}${profile.hash}`;
		const before = await factoryWorkspaceChanges(state.workspace, signal);
		let failure:
			| { stage: FactoryAppEnvironmentStage; detail: string }
			| undefined;
		let app: FactoryAppEnvironmentHandle | undefined;
		try {
			app = await startFactoryAppEnvironment({
				environment: profile.profile.environment,
				cwd: state.workspace.path,
				storageDir: input.storageDir,
				runId: `${run.runId}:${key}`,
				signal,
				record: (entry) => save({ verifierEnvironment: { key, ...entry } }),
			});
		} catch (error) {
			if (!(error instanceof FactoryAppEnvironmentError)) throw error;
			failure = { stage: error.stage, detail: error.detail };
		} finally {
			await app?.stop();
			forgetEnvironment();
		}
		const changes = await factoryWorkspaceChanges(state.workspace, signal);
		if (changes !== before) {
			failure ??= {
				stage: "worktree",
				detail: `setup, start or cleanup changed the worktree at the base commit. Gitignore generated files and keep tracked files such as lockfiles unchanged:\n${changes}`,
			};
			if (!before) await restoreFactoryWorktree(state.workspace, signal);
		}
		if (failure) {
			const detail = boundedPreflightDetail(failure.detail);
			save({
				verificationProfile: {
					hash: profile.hash,
					preflight: "failed",
					stage: failure.stage,
					detail,
				},
			});
			throw new FactoryVerificationProfileError(failure.stage, detail);
		}
		save({ verificationProfile: { hash: profile.hash, preflight: "passed" } });
		// Recording proof is bookkeeping; a later run preflights again without it.
		await input.onVerificationProfileProven?.(profile.hash).catch(() => {});
	};
	/** Repository stages frozen at run start; only this copy runs. */
	const stagePlan = state.stagePlan?.stages ?? [];
	/** The card's review size for `when.minSize`; undefined (no selection) runs the stage. */
	const stageSize = () =>
		state.reviewEscalation?.size ??
		(state.reviewSelection
			? factoryReviewSize(state.reviewSelection)
			: undefined);
	/** This round's write stage results, kept until the round's candidate is replaced. */
	const buildStages = () =>
		state.buildStages?.repairRound === state.repairRound
			? state.buildStages
			: undefined;
	/** Paths only write stages changed this round: not builder scope. */
	const stageOnlyPaths = () => {
		const build = buildStages();
		const builder = new Set(build?.builderPaths ?? []);
		return new Set(
			(build?.results ?? [])
				.flatMap((result) => result.changedPaths ?? [])
				.filter((path) => !builder.has(path)),
		);
	};
	/** Why a stage session gave up after its retries, for the stage's reason. */
	const retryReason = (error: unknown) =>
		oneLine(
			(error instanceof Error ? error.message : String(error)).replace(
				/^Factory \w+ retry limit reached: /,
				"the session failed: ",
			),
			500,
		);
	/**
	 * Runs this round's write stages after the builder and before the
	 * candidate is frozen, so the checks, tester and review cover their
	 * edits. Each stage's edits are committed on top of the builder's.
	 * Returns the checkpoint after them.
	 */
	const runWriteStages = async (checkpoint: {
		candidateCommit: string;
		diff: string;
		changedPaths: string[];
	}) => {
		const writeStages = stagePlan.filter(
			({ stage }) => stage.kind === "agent" && stage.access === "write",
		);
		if (!writeStages.length) return checkpoint;
		let build = buildStages() ?? {
			repairRound: state.repairRound,
			builderCommit: checkpoint.candidateCommit,
			builderPaths: checkpoint.changedPaths,
			results: [],
		};
		const record = (result: FactoryStageResult) => {
			build = {
				...build,
				results: [
					...build.results.filter((entry) => entry.id !== result.id),
					result,
				],
			};
			save({ buildStages: build });
		};
		save({ buildStages: build });
		let current = checkpoint;
		for (const { stage, hash } of writeStages) {
			if (stage.kind !== "agent") continue;
			// A finished stage of this round does not run again after a restart.
			if (
				build.results.some(
					(entry) => entry.id === stage.id && entry.hash === hash,
				)
			)
				continue;
			// Conditions are judged on the builder's own change.
			const skipped = factoryStageSkipReason(stage, {
				changedPaths: build.builderPaths,
				size: stageSize(),
			});
			if (skipped) {
				record({
					...factoryStageResultBase(stage, hash),
					status: "skipped",
					reason: skipped,
				});
				continue;
			}
			const before = current.candidateCommit;
			const startedAt = new Date().toISOString();
			save({ phase: state.repairRound > 0 ? "repairing" : "implementing" });
			let outcome: Pick<
				FactoryStageResult,
				"status" | "reason" | "summary" | "sessionId"
			>;
			try {
				const { sessionId, summary } = await execute(
					`stage:${stage.id}:${state.repairRound}`,
					factoryAgentStageInput({
						brief: task.instructions,
						commit: before,
						changedPaths: current.changedPaths,
						diff: current.diff,
					}),
					factoryAgentStageAgent(stage, agents.implementers[0]),
					"builder",
					undefined,
					undefined,
					stage.id,
				);
				outcome = {
					status: "passed",
					sessionId,
					summary: oneLine(summary, 500),
				};
			} catch (error) {
				if (!isFactoryRetryLimitError(error)) throw error;
				// Partial edits of a stage that could not finish never ship.
				await restoreFactoryWorktree(state.workspace, signal, before);
				outcome = { status: "error", reason: retryReason(error) };
			}
			await writeProfile(state.workspace);
			current = await checkpointFactoryWorkspace({
				includeChangedPaths: true,
				workspace: state.workspace,
				signal,
				message: factoryPullRequestTitle(task),
			});
			record({
				...factoryStageResultBase(stage, hash),
				...outcome,
				changedPaths: (
					await factoryChangedPathsBetween(
						state.workspace,
						before,
						current.candidateCommit,
						signal,
					)
				).slice(0, 100),
				startedAt,
				completedAt: new Date().toISOString(),
			});
			save({ phase: "verifying" });
			if (outcome.status === "error" && stage.blocking !== false)
				throw new FactoryStageError(
					`Repository stage "${stage.name}" could not run: ${outcome.reason}`,
				);
		}
		return current;
	};
	/** A read-only agent stage on the frozen candidate. */
	const runReadStage = async (
		stage: Extract<FactoryRepositoryStage, { kind: "agent" }>,
		hash: string,
		evidence: {
			commit: string;
			diff: string;
			changedPaths: string[];
			checks: FactoryCheckResult[];
		},
	): Promise<FactoryStageResult> => {
		const startedAt = new Date().toISOString();
		const base = { ...factoryStageResultBase(stage, hash), startedAt };
		try {
			const { sessionId, summary } = await execute(
				`stage:${stage.id}:${state.repairRound}:${evidence.commit}`,
				factoryAgentStageInput({ brief: task.instructions, ...evidence }),
				factoryAgentStageAgent(stage, agents.reviewers[0]),
				"reviewer",
				parseFactoryReview,
				undefined,
				stage.id,
			);
			await assertFactoryCandidate({
				workspace: state.workspace,
				candidateCommit: evidence.commit,
				signal,
			});
			return {
				...base,
				...factoryReadStageOutcome(parseFactoryReview(summary)),
				sessionId,
				completedAt: new Date().toISOString(),
			};
		} catch (error) {
			if (!isFactoryRetryLimitError(error)) throw error;
			return {
				...base,
				status: "error",
				reason: retryReason(error),
				completedAt: new Date().toISOString(),
			};
		}
	};
	// Rule cards are opt-in (repoRules), and a rule card never nominates more.
	const nominateRules =
		task.factory?.repoRules === true && !isFactoryRuleCard(task);
	const reviewerNotes = [
		nominateRules ? formatFactoryKnownRuleKeys(input.knownRuleKeys ?? []) : "",
		profile
			? formatFactoryVerificationProfileForFinalReviewer(profile.hash)
			: "",
	]
		.filter(Boolean)
		.map((note) => `\n\n${note}`)
		.join("");
	try {
		// A verifier app recorded but never stopped was left by a crash or restart.
		const leftover = state.verifierEnvironment;
		if (leftover) {
			await stopFactoryAppEnvironment({
				environment: leftover.key.startsWith(PREFLIGHT_KEY_PREFIX)
					? profile?.profile.environment
					: agents.verifier?.environment,
				cwd: state.workspace.path,
				record: leftover,
			});
			save({ verifierEnvironment: undefined });
		}
		const configurationFindings = [
			...factoryCheckConfigurationFindings(config.checks, task.workspaceRoot),
			...factoryAcceptanceConfigurationFindings({ ...config, agents }),
		];
		if (configurationFindings.length)
			throw new FactoryPlanConfigurationError(configurationFindings);
		// A card that cannot open its draft PR stops before spending a build;
		// the base is resolved again on every attempt, so a retry after the
		// user publishes the branch uses it.
		if (config.publishPullRequest && !state.pullRequestUrl)
			save({
				pullRequestBase: await recordPublishFailure(() =>
					resolveFactoryPullRequestBase({
						workspace: state.workspace,
						signal,
					}),
				),
				pullRequestError: undefined,
			});
		if (state.candidate && !state.attempts && !input.repairInstructions)
			throw new FactoryDecisionError(
				"This Factory run predates durable attempts; inspect its candidate before starting a new implementation",
			);
		await preflightProfile();
		await refreshUsage();
		const units = config.implementationUnits;
		if (units && !state.implementationIntegrated) {
			const completed = new Set(
				(state.implementationUnits ?? [])
					.filter((unit) => unit.status === "completed")
					.map((unit) => unit.id),
			);
			while (completed.size < units.length) {
				const eligible = units.filter(
					(unit) =>
						!completed.has(unit.id) &&
						unit.dependsOn.every((id) => completed.has(id)),
				);
				if (eligible.length === 0)
					throw new Error(
						"Implementation units have no runnable dependency set",
					);
				const outcomes = await Promise.allSettled(
					eligible.map(async (unit) => {
						let saved = state.implementationUnits?.find(
							(entry) => entry.id === unit.id,
						);
						if (!saved) {
							const workspace = await prepareFactoryWorkspace({
								sourceRoot: state.workspace.path,
								taskId: `${task.taskId}:${task.revision}:${unit.id}`,
								storageDir: input.storageDir,
								signal,
							});
							saved = { id: unit.id, workspace, status: "implementing" };
							save({
								implementationUnits: [
									...(state.implementationUnits ?? []),
									saved,
								],
							});
						}
						const unitKey = `unit:${unit.id}`;
						const dependencies = state.attempts?.some(
							(attempt) => attempt.key === unitKey,
						)
							? []
							: unit.dependsOn;
						for (const dependency of dependencies) {
							const parent = state.implementationUnits?.find(
								(entry) => entry.id === dependency,
							);
							if (parent?.status !== "completed")
								throw new Error("Implementation dependency is incomplete");
							await integrate(saved.workspace, parent.commit);
						}
						await writeProfile(saved.workspace);
						await execute(
							unitKey,
							`${implementationInstructions}\n\nYour isolated implementation unit: ${unit.instructions}\nImplement only this unit. Dependencies are already integrated.`,
							agents.implementers[
								units.indexOf(unit) % agents.implementers.length
							],
							"builder",
							undefined,
							saved.workspace,
						);
						await writeProfile(saved.workspace);
						const { candidateCommit } = await checkpointFactoryWorkspace({
							workspace: saved.workspace,
							signal,
						});
						const result = {
							id: unit.id,
							workspace: saved.workspace,
							status: "completed" as const,
							commit: candidateCommit,
						};
						save({
							implementationUnits: (state.implementationUnits ?? []).map(
								(entry) => (entry.id === unit.id ? result : entry),
							),
						});
						completed.add(unit.id);
					}),
				);
				for (const outcome of outcomes)
					if (outcome.status === "rejected") throw outcome.reason;
			}
			for (const unit of state.implementationUnits ?? []) {
				if (unit.status !== "completed")
					throw new Error("Implementation unit is incomplete");
				await integrate(state.workspace, unit.commit);
			}
			save({ implementationIntegrated: true });
		}
		const buildKey = `builder:${state.repairRound}`;
		if (
			!(
				config.implementationUnits &&
				!state.repairInstructions &&
				!input.repairInstructions
			) &&
			!state.attempts?.some(
				(entry) => entry.key === buildKey && entry.status === "completed",
			)
		) {
			if (state.candidate)
				save({
					candidateHistory: [
						...(state.candidateHistory ?? []),
						state.candidate,
					],
					candidate: undefined,
				});
			await writeProfile(state.workspace);
			await execute(
				buildKey,
				builderInstructions(),
				agents.implementers[0],
				"builder",
			);
		}
		while (true) {
			save({
				phase: "verifying",
			});
			if (state.candidate)
				await assertFactoryCandidate({
					workspace: state.workspace,
					candidateCommit: state.candidate.commit,
					signal,
				});
			await writeProfile(state.workspace);
			const checkpoint = await checkpointFactoryWorkspace({
				includeChangedPaths:
					Boolean(state.reviewSelection && !state.reviewEscalation) ||
					stagePlan.length > 0,
				workspace: state.workspace,
				signal,
				message: factoryPullRequestTitle(task),
			});
			if (
				state.candidate &&
				state.candidate.commit !== checkpoint.candidateCommit
			)
				throw new FactoryDecisionError(
					"Factory candidate changed while verification was interrupted",
				);
			// Write stages run only before the freeze, never on a frozen candidate.
			const { candidateCommit, diff, changedPaths } = state.candidate
				? checkpoint
				: await runWriteStages(checkpoint);
			const stagePaths = stageOnlyPaths();
			const selection = state.reviewSelection;
			if (selection && !state.reviewEscalation) {
				// Factory writes the profile file; it is not builder scope.
				const builderPaths = changedPaths.filter(
					(path) => !(profile && path === FACTORY_VERIFICATION_PROFILE_PATH),
				);
				// Paths only a repository write stage changed are not the
				// builder's scope; they stay in the size and the reviewed diff.
				const outsidePaths = builderPaths.filter(
					(path) =>
						!stagePaths.has(path) &&
						!selection.affectedPaths.some(
							(declared) =>
								path === declared || path.startsWith(`${declared}/`),
						),
				);
				const progress = task.factoryDesignProgress;
				const pool =
					progress?.revision === task.revision && progress.reviewSelection
						? progress.agents.reviewers
						: undefined;
				// The builder's diff, without the Factory-written profile.
				const size = factoryDiffSize(
					profile
						? withoutDiffFile(diff, FACTORY_VERIFICATION_PROFILE_PATH)
						: diff,
				);
				const sizeEscalation = factoryReviewSizeEscalation({
					selection,
					...size,
					changedPaths: builderPaths,
					reviewerPool: pool?.length ?? 0,
					minCodeReviewers: config.minCodeReviewers,
				});
				if (outsidePaths.length || sizeEscalation) {
					if (!pool && outsidePaths.length)
						throw new Error(
							"The frozen adaptive reviewer pool is missing for scope escalation",
						);
					// Reviewers are only added, after the selected ones, so the
					// review set (and the rating behind it) never shrinks. Without
					// a frozen pool the recorded escalation still requires a
					// person's stamp (factoryStampRequirement).
					const added = (pool ?? []).filter(
						(_, index) =>
							!selection.reviewerIndices.includes(index) &&
							(outsidePaths.length > 0 ||
								Boolean(sizeEscalation?.reviewerIndices.includes(index))),
					);
					agents = { ...agents, reviewers: [...agents.reviewers, ...added] };
					save({
						agents,
						reviewEscalation: {
							commit: candidateCommit,
							affectedPaths: outsidePaths.length
								? outsidePaths
								: builderPaths.slice(0, 100),
							rationale: [
								outsidePaths.length
									? "Candidate changes extend beyond the design's affected paths; all frozen final reviewers are required for this run."
									: "",
								sizeEscalation?.rationale ?? "",
							]
								.filter(Boolean)
								.join(" "),
							...(sizeEscalation ? { size: sizeEscalation.size } : {}),
						},
					});
				}
			}
			const written = buildStages()?.results;
			let candidate: FactoryCandidate = state.candidate ?? {
				commit: candidateCommit,
				checks: [],
				reviews: [],
				...(written?.length ? { stages: written } : {}),
			};
			save({ candidate });
			const checks =
				candidate.checks.length === config.checks.length
					? candidate.checks
					: await verifyFactoryChecks({
							checks: config.checks,
							workspace: state.workspace,
							candidateCommit,
							storageDir: input.storageDir,
							runId: run.runId,
							signal,
							timeoutMs: (task.timeoutSeconds ?? 600) * 1000,
						});
			candidate = { ...candidate, checks };
			save({ candidate });
			const misconfigured = checks.filter(
				(check) => check.blockedBy === "configuration",
			);
			// Builder repair cannot fix a check's definition; stop without
			// spending repair rounds on it.
			if (misconfigured.length) {
				const findings = misconfigured.map(
					(check) => `${check.name}: ${relative(factoryCheckReason(check))}`,
				);
				throw new FactoryPlanConfigurationError(
					[
						...factoryCheckConfigurationFindings(
							config.checks,
							task.workspaceRoot,
						),
						...findings.map(
							(finding) =>
								`Check configuration blocked verification: ${finding}. Refine the check so its artifacts are repository-relative paths inside the worktree.`,
						),
					],
					`Check configuration blocked verification: ${findings.join(
						"; ",
					)}. Refine the plan's checks so their artifacts are repository-relative paths inside the worktree.`,
				);
			}
			const checkFindings = checks
				.filter((check) => check.status !== "passed")
				.map((check) => `${check.name}: ${check.status}\n${check.output}`);
			/** Records a stage result on the candidate, in file order. */
			const recordStage = (result: FactoryStageResult) => {
				const order = (id: string) =>
					stagePlan.findIndex((entry) => entry.stage.id === id);
				candidate = {
					...candidate,
					stages: [
						...(candidate.stages ?? []).filter(
							(entry) => entry.id !== result.id && order(entry.id) >= 0,
						),
						result,
					].sort((a, b) => order(a.id) - order(b.id)),
				};
				save({ candidate });
			};
			// Repository stages run on the frozen candidate once the plan's
			// checks pass. Passed, failed and skipped are final for the commit,
			// so a restart does not rerun them.
			if (checkFindings.length === 0)
				for (const { stage, hash } of stagePlan) {
					if (stage.kind === "agent" && stage.access === "write") continue;
					const recorded = candidate.stages?.find(
						(entry) => entry.id === stage.id && entry.hash === hash,
					);
					if (
						recorded &&
						(recorded.status === "passed" ||
							recorded.status === "failed" ||
							recorded.status === "skipped")
					)
						continue;
					const skipped = factoryStageSkipReason(stage, {
						changedPaths,
						size: stageSize(),
					});
					let result: FactoryStageResult;
					if (skipped)
						result = {
							...factoryStageResultBase(stage, hash),
							status: "skipped",
							reason: skipped,
						};
					else {
						recordStage({
							...factoryStageResultBase(stage, hash),
							status: "running",
							startedAt: new Date().toISOString(),
						});
						result =
							stage.kind === "command"
								? await runFactoryCommandStage({
										stage,
										hash,
										workspace: state.workspace,
										candidateCommit,
										storageDir: input.storageDir,
										runId: run.runId,
										signal,
									})
								: await runReadStage(stage, hash, {
										commit: candidateCommit,
										diff,
										changedPaths,
										checks,
									});
					}
					recordStage(result);
					// The builder cannot fix a stage that cannot run.
					if (result.status === "error" && result.blocking)
						throw new FactoryStageError(
							`Repository stage "${stage.name}" could not run: ${result.reason ?? "unknown reason"}`,
						);
				}
			const stageFindings =
				checkFindings.length === 0
					? factoryStageFindings(candidate.stages).map(relative)
					: [];
			const stageEvidence = formatFactoryStageResults(candidate.stages);

			const verifierKey = `verifier:${state.repairRound}:${candidateCommit}:${state.verificationRetry ?? 0}`;
			const environment = agents.verifier?.environment;
			let app: FactoryAppEnvironmentHandle | undefined;
			let environmentFinding: string | undefined;
			// Started before either lane so a broken environment blocks the run
			// without spending verifier or reviewer sessions.
			if (
				checkFindings.length === 0 &&
				stageFindings.length === 0 &&
				environment &&
				!candidate.verification &&
				!state.attempts?.some(
					(entry) => entry.key === verifierKey && entry.status === "completed",
				)
			)
				try {
					app = await startFactoryAppEnvironment({
						environment,
						cwd: state.workspace.path,
						storageDir: input.storageDir,
						runId: run.runId,
						signal,
						record: (entry) =>
							save({ verifierEnvironment: { key: verifierKey, ...entry } }),
					});
					// Setup runs after the clean-candidate check, so anything it or the
					// app writes outside gitignored paths would only surface after the
					// verifier session as a changed candidate. Fail here instead.
					const changes = await factoryWorkspaceChanges(
						state.workspace,
						signal,
					);
					if (changes)
						throw new FactoryAppEnvironmentError(
							"worktree",
							`setup or start changed the candidate worktree. Gitignore generated files and keep tracked files such as lockfiles unchanged:\n${changes}`,
						);
				} catch (error) {
					await app?.stop();
					forgetEnvironment();
					app = undefined;
					// The profile's own environment passed a preflight (or was proven
					// before), so failing on this candidate is a candidate defect.
					if (
						!(error instanceof FactoryAppEnvironmentError) ||
						!profile ||
						environmentIdentity(environment) !==
							environmentIdentity(profile.profile.environment)
					)
						throw error;
					if (error.stage === "worktree")
						await restoreFactoryWorktree(state.workspace, signal);
					environmentFinding = `Verification app: the repository verification profile runs at the base commit but not on this candidate. ${error.message}`;
				}
			const lanesOpen =
				checkFindings.length === 0 &&
				stageFindings.length === 0 &&
				!environmentFinding;
			let appStopped = false;
			const stopApp = async () => {
				if (!app || appStopped) return;
				appStopped = true;
				await app.stop();
				forgetEnvironment();
			};
			const appInstructions = !app
				? "Start the application as described by any app setup in your role instructions and wait for its ready signal. Stop every server or process you started before returning, including after failures, and state the cleanup result in summary."
				: environment?.start
					? `FACTORY APP ENVIRONMENT: the application is already running at ${app.url} (port ${app.port}); its output is logged at ${app.logPath}. Factory started it and will stop it: do not start, restart or stop it, and do not rerun its setup. Stop every other server or process you start before returning, including after failures, and state the cleanup result in summary.`
					: `FACTORY APP ENVIRONMENT: Factory already ran the app setup. Start the application as described in your role instructions on port ${app.port} (${app.url}) and wait for its ready signal. Stop every server or process you started before returning, including after failures, and state the cleanup result in summary.`;
			const verification = async () => {
				if (lanesOpen && agents.verifier && !candidate.verification) {
					const declaredPaths = agents.verifier.artifacts ?? [];
					const key = verifierKey;
					if (state.verifierBaseline?.key !== key)
						save({
							verifierBaseline: {
								key,
								versions: (
									await captureFactoryArtifactVersions(
										state.workspace.path,
										declaredPaths,
									)
								).map((version) => version ?? null),
							},
						});
					const previousVersions =
						state.verifierBaseline?.versions.map(
							(version) => version ?? undefined,
						) ?? [];
					const { sessionId, summary: response } = await execute(
						key,
						`Verify the approved behavior by running the existing application and test harness using available tools. Search for and reuse the project's existing verification scripts. You may create gitignored scratch verification scripts and artifacts for supplemental checks, but do not modify approved tracked source, tests, or harness files. Do not fabricate screenshots or claim interactions you did not perform. Generate fresh screenshot or recording evidence at these gitignored worktree paths: ${JSON.stringify(declaredPaths)}. Before reporting a required gap, run additional non-mutating checks for uncovered approved behavior using the available harness and tools. Reuse existing command evidence; do not demand duplicate curl calls or an image for every transition when direct behavioral assertions establish it. Supply the declared fresh visual artifacts, and describe what each assertion actually proves. For required execution or capability gaps, describe what you tried in coverage.requiredGaps; missing verifier evidence is not a builder defect. ${appInstructions} ${responseFormat}${verifierCriteria.length ? ` Also include "acceptance":[{"criterionId":"...","outcome":"passed"|"failed"|"unverified","evidence":"what you executed and observed"}] with one entry for each criterion under ACCEPTANCE CRITERIA, judged from fresh execution in this attempt rather than earlier reports. A required criterion that you could not verify is "unverified" and also belongs in coverage.requiredGaps; a failed required criterion means changes_requested with the defect in findings. Optional criteria ("required": false) never block: report their failures or gaps in coverage.limitations, not findings or requiredGaps.` : ""}\n\nAPPROVED BRIEF:\n${task.instructions}\nCANDIDATE COMMIT: ${candidateCommit}\nCHECK EVIDENCE:\n${JSON.stringify(checks)}${stageEvidence}${verifierCriteria.length ? `\n\nACCEPTANCE CRITERIA:\n${JSON.stringify(verifierCriteria)}` : ""}\n\nREQUIRED GAPS FROM THE PREVIOUS VERIFICATION ATTEMPT:\n${JSON.stringify(state.verificationFeedback?.commit === candidateCommit ? state.verificationFeedback.verifier : [])}`,
						agents.verifier,
						"verifier",
						parseFactoryVerification,
					).finally(stopApp);
					await assertFactoryCandidate({
						workspace: state.workspace,
						candidateCommit,
						signal,
					});
					let review = parseFactoryVerification(response);
					let artifacts: FactoryArtifact[] = [];
					if (factoryReviewFindings(review).length === 0) {
						try {
							artifacts = await collectFactoryArtifacts({
								cwd: state.workspace.path,
								declaredPaths,
								previousVersions,
								storageDir: input.storageDir,
								runId: run.runId,
							});
						} catch (error) {
							review = {
								...review,
								verdict: "changes_requested",
								summary: "Verifier evidence could not be collected.",
								coverage: {
									static: review.coverage?.static ?? [],
									exercised: review.coverage?.exercised ?? [],
									limitations: review.coverage?.limitations ?? [],
									requiredGaps: [
										error instanceof Error ? error.message : String(error),
									],
								},
							};
						}
					}
					candidate = {
						...candidate,
						verification: { sessionId, review, artifacts },
					};
					save({ candidate });
				}
			};
			const reviewCandidate = async () => {
				if (lanesOpen) {
					save({ phase: "reviewing" });
					const reviews = await Promise.allSettled(
						agents.reviewers.map(async (agent, reviewerIndex) => {
							if (
								candidate.reviews.some(
									(entry) => entry.reviewerIndex === reviewerIndex,
								)
							)
								return;
							const { sessionId, summary: response } = await execute(
								`reviewer:${reviewerIndex}:${state.repairRound}:${candidateCommit}:${state.verificationRetry ?? 0}`,
								`Independently review this candidate against the approved brief. Search affected modules for existing helpers and equivalent operations, and read a representative implementation before judging departures. Assess correctness and maintainability separately, with concrete examples and a distinction between worthwhile cleanup and subjective style. Challenge duplicated logic, unnecessary abstractions or state, speculative compatibility, redundant defensive checks, opaque parameters, and avoidable branching. Identify the current requirement and smallest clearer behavior-preserving alternative. Review tests for distinct meaningful behavior and comments for intent, invariants, or protocol constraints rather than narration. Trace every changed return value, event payload, and persisted structure through producer -> transformation -> consumer, including tool-specific handlers, UI renderers, accounting, and restore/resume. Compare below/above thresholds, including built-in orchestration and external/custom tools. Trace actual user-visible consequences for this static code-review role.${agents.verifier ? " The configured behavioral verifier runs concurrently; its results may not exist yet. Pending or unavailable verifier output is not a code finding or a gap owned by this static-review role." : ""} Do not claim you ran checks you did not run, and do not mark the lack of your own execution as a required gap. State that role limitation in summary; coverage.requiredGaps contains only required static-review criteria you could not assess. Challenge the stated impact and consumers against the actual full diff, including same-file contract changes. Report underestimated impact or genuinely inadequate approved verification requirements as a blocking finding; distinguish missing requirements from unfinished verification results. Do not consult other reviewers' conclusions. Do not change files. Never treat passing tests as proof of correctness. ${responseFormat}${nominateRules ? ` ${FACTORY_RULE_NOMINATION_INSTRUCTION}` : ""}${reviewerNotes}\n\nREVIEW SELECTION AND ESCALATION:\n${JSON.stringify({ selection: state.reviewSelection, escalation: state.reviewEscalation })}\n\nAPPROVED BRIEF:\n${task.instructions}${input.repairInstructions ? `\n\nVerify this feedback without broadening scope:\n${input.repairInstructions}` : ""}\n\nCANDIDATE COMMIT: ${candidateCommit}\nCHECK EVIDENCE:\n${JSON.stringify(checks)}${stageEvidence}\n\nFULL DIFF:\n${diff}\n\nREQUIRED GAPS FROM YOUR PREVIOUS REVIEW ATTEMPT:\n${JSON.stringify(state.verificationFeedback?.commit === candidateCommit ? (state.verificationFeedback.reviewers.find((entry) => entry.reviewerIndex === reviewerIndex)?.gaps ?? []) : [])}`,
								agent,
								"reviewer",
								parseFactoryReview,
							);
							await assertFactoryCandidate({
								workspace: state.workspace,
								candidateCommit,
								signal,
							});
							const review = parseFactoryReview(response);
							candidate = {
								...candidate,
								reviews: [
									...candidate.reviews,
									{ reviewerIndex, sessionId, review },
								],
							};
							save({ candidate });
						}),
					);
					for (const review of reviews)
						if (review.status === "rejected") throw review.reason;
				}
			};
			const lanes = await Promise.allSettled([
				verification(),
				reviewCandidate(),
			]).finally(stopApp);
			for (const lane of lanes)
				if (lane.status === "rejected") throw lane.reason;
			const unmet = unmetFactoryAcceptance(
				config.acceptanceCriteria,
				candidate,
			);
			const findings = [
				...checkFindings,
				...stageFindings,
				...(environmentFinding ? [environmentFinding] : []),
				...unmet.repair,
				...(candidate.verification
					? factoryReviewFindings(candidate.verification.review).map(
							(finding) => `Verification: ${finding}`,
						)
					: []),
				...candidate.reviews.flatMap((entry) =>
					factoryReviewFindings(entry.review).map(
						(finding) => `Reviewer ${entry.reviewerIndex + 1}: ${finding}`,
					),
				),
			];
			candidate = {
				...candidate,
				reviews: [...candidate.reviews].sort(
					(a, b) => a.reviewerIndex - b.reviewerIndex,
				),
			};
			save({ candidate });
			await assertFactoryCandidate({
				workspace: state.workspace,
				candidateCommit,
				signal,
			});
			if (
				findings.length === 0 &&
				unmet.verify.length === 0 &&
				candidate.reviews.length === agents.reviewers.length &&
				(!agents.verifier || candidate.verification)
			) {
				// PR follow-up keeps the requirement frozen at delivery.
				save({
					humanReview:
						input.repairInstructions && state.humanReview
							? state.humanReview
							: factoryStampRequirement(config, state),
				});
				// Publishing follows verification and review; PR follow-up
				// pushes its own repair.
				const created =
					config.publishPullRequest &&
					!input.repairInstructions &&
					state.pullRequestWatch?.headCommit !== candidateCommit
						? await publishCandidate(
								candidate,
								await pullRequestSection(candidate),
							)
						: false;
				// Only the draft this delivery opened, and only when nothing
				// needs a person (factoryPullRequestReadyAllowed). Best effort:
				// a failure leaves it a draft.
				const recordedIndependence = factoryRecordedReviewIndependence(state);
				if (
					created &&
					state.pullRequestUrl &&
					factoryPullRequestReadyAllowed(
						{ ...config, agents },
						state,
						recordedIndependence
							? recordedIndependence.independent === true
							: factoryIndependentReview(agents, task.modelSelection)
									.independent,
					)
				) {
					const marked = await markFactoryPullRequestReady({
						workspace: state.workspace,
						url: state.pullRequestUrl,
						signal,
					}).catch((error: unknown) => {
						if (signal.aborted) throw error;
						return false;
					});
					if (marked) save({ pullRequestReady: true });
				}
				let pullRequestWatch = state.pullRequestWatch;
				if (input.repairInstructions && pullRequestWatch?.pending) {
					pullRequestWatch = {
						...pullRequestWatch,
						pending: { ...pullRequestWatch.pending, phase: "publish" },
					};
				} else if (state.pullRequestUrl) {
					pullRequestWatch = {
						...pullRequestWatch,
						headCommit: candidateCommit,
						handledFeedbackIds: pullRequestWatch?.handledFeedbackIds ?? [],
					};
				}
				save({
					phase: pullRequestWatch ? "watching" : "ready",
					verificationFeedback: undefined,
					pullRequestChecks: pullRequestWatch
						? state.pullRequestChecks?.headCommit === candidateCommit
							? state.pullRequestChecks
							: { headCommit: candidateCommit, status: "unknown", checks: [] }
						: undefined,
					pullRequestWatch,
				});
				// A new PR already carries this description.
				const descriptionNote =
					state.pullRequestUrl && !input.repairInstructions && !created
						? await describePullRequest(
								state.pullRequestUrl,
								await pullRequestSection(candidate),
							)
						: "";
				return {
					status: "completed",
					summary: `Verified candidate ${candidateCommit}. ${config.publishPullRequest ? `${state.pullRequestReady ? "Pull request published and marked ready for review" : "Draft pull request published"}; required current-head CI remains a separate gate.` : "Changes ready for review; publishing is disabled."}${descriptionNote ? ` ${descriptionNote}` : ""}`,
				};
			}
			const requiredGaps = [
				...(candidate.verification?.review.coverage?.requiredGaps ?? []),
				...candidate.reviews.flatMap(
					(entry) => entry.review.coverage?.requiredGaps ?? [],
				),
				...unmet.verify,
			];
			if (
				requiredGaps.length &&
				!environmentFinding &&
				!hasCodeFindings(candidate, unmet)
			) {
				save(retryUnavailableFactoryVerification(state, config));
				continue;
			}
			// The task error stays short; full check output remains in the
			// run's candidate evidence (`candidate.checks[].output`).
			if (state.repairRound >= repairLimit()) {
				const unresolved = [
					...checks
						.filter((check) => check.status !== "passed")
						.map(
							(check) =>
								`Check "${check.name}" ${check.status}: ${factoryCheckReason(check)}`,
						),
					...findings.slice(checkFindings.length),
				].map((finding) => {
					const text = relative(finding).trim();
					return text.length > UNRESOLVED_FINDING_CHARS
						? `${text.slice(0, UNRESOLVED_FINDING_CHARS - 1)}…`
						: text;
				});
				// Only review findings remain: the candidate passed its checks
				// and verification, so it is published as a draft PR with the
				// findings for a person instead of being lost. Failed checks and
				// failed or unavailable verification never publish.
				const reviewFindingsOnly =
					checkFindings.length === 0 &&
					stageFindings.length === 0 &&
					!environmentFinding &&
					unmet.repair.length === 0 &&
					requiredGaps.length === 0 &&
					candidate.reviews.length === agents.reviewers.length &&
					(!agents.verifier ||
						(candidate.verification !== undefined &&
							factoryReviewFindings(candidate.verification.review).length ===
								0));
				// Saved before any push, so a failed publication keeps them.
				save({
					unresolvedFindings: { commit: candidateCommit, findings: unresolved },
				});
				// Findings that may concern security never leave the machine.
				const sensitive = unresolved.some((finding) =>
					FACTORY_SECURITY_FINDING.test(finding),
				);
				const publishOpenFindings =
					reviewFindingsOnly &&
					config.publishPullRequest &&
					!input.repairInstructions;
				let created = false;
				if (publishOpenFindings && sensitive)
					save({
						humanReview: {
							required: true,
							reason: FACTORY_SECURITY_FINDINGS_REVIEW,
						},
					});
				else if (publishOpenFindings) {
					save({
						humanReview: {
							required: true,
							reason: FACTORY_UNRESOLVED_FINDINGS_REVIEW,
						},
					});
					if (
						!state.pullRequestUrl ||
						state.pullRequestWatch?.headCommit !== candidateCommit
					)
						created = await publishCandidate(
							candidate,
							await pullRequestSection(candidate),
						);
				}
				// The draft PR shows this candidate: it stays open and waits for
				// a person. Its description says nothing about the findings; the
				// card lists them.
				const pullRequestUrl =
					state.pullRequestWatch?.headCommit === candidateCommit
						? state.pullRequestUrl
						: undefined;
				save({
					unresolvedFindings: {
						commit: candidateCommit,
						findings: unresolved,
						...(pullRequestUrl ? { pullRequestOpen: true } : {}),
					},
					...(pullRequestUrl
						? {
								humanReview: {
									required: true,
									reason: FACTORY_UNRESOLVED_FINDINGS_REVIEW,
								},
							}
						: {}),
				});
				const descriptionNote =
					pullRequestUrl && !created
						? await describePullRequest(
								pullRequestUrl,
								await pullRequestSection(candidate),
							)
						: "";
				throw new FactoryDecisionError(
					`Repair limit (${repairLimit()}) reached${pullRequestUrl ? `; the draft PR stays open with ${unresolved.length === 1 ? "1 unresolved finding" : `${unresolved.length} unresolved findings`}` : publishOpenFindings && sensitive ? "; an unresolved finding may be security-sensitive, so the work stays local and the branch was not pushed" : ""}.\n${unresolved
						.map((finding) => `- ${oneLine(finding)}`)
						.join("\n")}${descriptionNote ? `\n${descriptionNote}` : ""}`,
				);
			}
			const repairInstructions = `Address these consolidated blocking findings within the approved scope. Do not weaken checks or acceptance criteria, publish, push, or open a PR.\n\n${findings.join("\n\n")}`;
			save({
				repairInstructions,
				humanApproval: undefined,
				pullRequestChecks: undefined,
				candidateHistory: [...(state.candidateHistory ?? []), candidate],
				phase: "repairing",
				repairRound: state.repairRound + 1,
				candidate: undefined,
			});
			await execute(
				`builder:${state.repairRound}`,
				builderInstructions(),
				agents.implementers[0],
				"builder",
			);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!signal.aborted && !(error instanceof FactoryPersistenceError))
			save({
				phase: "blocked",
				error: message,
				pullRequestWatch: state.pullRequestWatch?.pending
					? {
							...state.pullRequestWatch,
							pending: { ...state.pullRequestWatch.pending, phase: "blocked" },
						}
					: state.pullRequestWatch,
			});
		throw error;
	}
}

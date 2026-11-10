import type {
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	FactoryArtifact,
	FactoryCandidate,
	FactoryRunState,
	FactoryWorkspace,
} from "@cline/shared";
import { DEFAULT_FACTORY_AGENTS } from "@cline/shared";
import type {
	AgendaTaskRuntime,
	AgendaTaskRuntimeResult,
} from "./agenda-task-manager";
import { factoryReviewFindings, parseFactoryReview } from "./factory-agents";
import {
	assertFactoryCandidate,
	captureFactoryArtifactVersions,
	checkpointFactoryWorkspace,
	collectFactoryArtifacts,
	factoryCheckConfigurationFindings,
	finishFactoryIntegration,
	integrateFactoryCommit,
	prepareFactoryWorkspace,
	publishFactoryPullRequest,
	verifyFactoryChecks,
} from "./factory-local";

import {
	createFactorySessionRunner,
	FactoryPersistenceError,
} from "./factory-session";

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
};

function hasCodeFindings(candidate: FactoryCandidate): boolean {
	const reviews = [
		...candidate.reviews.map((entry) => entry.review),
		...(candidate.verification ? [candidate.verification.review] : []),
	];
	return (
		candidate.checks.some((check) => check.status !== "passed") ||
		reviews.some(
			(review) =>
				review.findings.length > 0 ||
				(review.verdict === "changes_requested" &&
					!review.coverage?.unverified.length),
		)
	);
}

export function retryUnavailableFactoryVerification(
	state: FactoryRunState,
	maxRetries: number,
): FactoryRunState {
	const candidate = state.candidate;
	if (!candidate || hasCodeFindings(candidate)) return state;
	const verifier = candidate.verification?.review.coverage?.unverified ?? [];
	const reviewers = candidate.reviews
		.filter((entry) => entry.review.coverage?.unverified.length)
		.map((entry) => ({
			reviewerIndex: entry.reviewerIndex,
			gaps: entry.review.coverage?.unverified ?? [],
		}));
	if (!verifier.length && !reviewers.length) return state;
	const verificationRetry = (state.verificationRetry ?? 0) + 1;
	if (verificationRetry > maxRetries)
		throw new Error(
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
				(entry) => !entry.review.coverage?.unverified.length,
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
	const agents = input.state.agents ?? config.agents ?? DEFAULT_FACTORY_AGENTS;
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
	const { execute, refreshUsage } = createFactorySessionRunner({
		...input,
		getState: () => state,
		save,
	});
	const integrate = async (workspace: FactoryWorkspace, commit: string) => {
		while (
			(await integrateFactoryCommit({ workspace, commit, signal })) ===
			"conflicted"
		) {
			const prefix = `integration:${workspace.branch}:${commit}:`;
			const repairs = (state.integrationRepairs ?? []).filter((repair) =>
				repair.key.startsWith(prefix),
			);
			const active = repairs.find((repair) => repair.status === "running");
			const key = active?.key ?? `${prefix}${repairs.length}`;
			if (!active) {
				if (state.repairRound >= config.maxRepairRounds)
					throw new Error(
						`Repair limit (${config.maxRepairRounds}) reached resolving implementation integration`,
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
				`Resolve only the pending merge of implementation commit ${commit} within the approved scope. Preserve both units' intended behavior. Inspect the actual conflicted paths, resolve conflict markers and stage the resolution. Do not abort/reset the merge, weaken checks, publish, or push. The factory will checkpoint and independently verify the result.\n\nAPPROVED BRIEF:\n${task.instructions}`,
				agents.implementer,
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
	const responseFormat =
		'Return only JSON matching {"verdict":"pass"|"changes_requested","summary":"...","findings":["..."],"coverage":{"static":["..."],"exercised":["..."],"unverified":["..."]}}; pass requires zero findings and zero required coverage gaps. coverage.unverified is only for REQUIRED approved criteria owned by your role that you could not verify; put nonblocking scope/tool limitations in the private summary without claiming all paths were verified. coverage.exercised lists only checks or actions you personally executed; reading reported output from another role belongs in coverage.static or summary. Never invent evidence or erase a required gap merely to pass. If submit_and_exit is available, put that exact JSON in its summary field. Keep coverage private; never publish it.';
	try {
		const checkConfigurationFindings = factoryCheckConfigurationFindings(
			config.checks,
			task.workspaceRoot,
		);
		if (checkConfigurationFindings.length)
			throw new Error(checkConfigurationFindings.join("\n"));
		if (state.candidate && !state.attempts && !input.repairInstructions)
			throw new Error(
				"This Factory run predates durable attempts; inspect its candidate before starting a new implementation",
			);
		await refreshUsage();
		if (config.implementationUnits && !state.implementationIntegrated) {
			const completed = new Set(
				(state.implementationUnits ?? [])
					.filter((unit) => unit.status === "completed")
					.map((unit) => unit.id),
			);
			while (completed.size < config.implementationUnits.length) {
				const eligible = config.implementationUnits.filter(
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
						await execute(
							unitKey,
							`${task.instructions}\n\nYour isolated implementation unit: ${unit.instructions}\nImplement only this unit. Dependencies are already integrated. Do not publish or push.`,
							agents.implementer,
							"builder",
							undefined,
							saved.workspace,
						);
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
			await execute(
				buildKey,
				`${state.repairInstructions ?? task.instructions}${input.repairInstructions ? `\n\nPR FOLLOW-UP:\n${input.repairInstructions}` : ""}\n\nAPPROVED VERIFICATION CHECKS:\n${JSON.stringify(config.checks)}\nEvidence must be generated by these checks in gitignored paths. Do not modify approved checks or acceptance criteria.\n\nImplement only this approved scope. Reuse existing code. Avoid duplicated logic, speculative abstractions, unrelated changes, and comments that narrate code. Do not publish, push, or open a pull request. The factory will run the approved checks and independent review.`,
				agents.implementer,
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
			const { candidateCommit, diff } = await checkpointFactoryWorkspace({
				workspace: state.workspace,
				signal,
			});
			if (state.candidate && state.candidate.commit !== candidateCommit)
				throw new Error(
					"Factory candidate changed while verification was interrupted",
				);
			let candidate: FactoryCandidate = state.candidate ?? {
				commit: candidateCommit,
				checks: [],
				reviews: [],
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
			const checkFindings = checks
				.filter((check) => check.status !== "passed")
				.map((check) => `${check.name}: ${check.status}\n${check.output}`);

			if (
				checkFindings.length === 0 &&
				config.publishPullRequest &&
				!input.repairInstructions &&
				state.pullRequestWatch?.headCommit !== candidateCommit
			) {
				save({ phase: "publishing" });
				const pullRequestUrl = await publishFactoryPullRequest({
					workspace: state.workspace,
					candidateCommit,
					title: task.title,
					body: `Draft candidate ${candidateCommit} passed the approved deterministic checks. Independent review and behavioral verification are in progress; this is not a readiness claim.`,
					signal,
				});
				save({
					pullRequestUrl,
					pullRequestWatch: {
						...state.pullRequestWatch,
						headCommit: candidateCommit,
						handledFeedbackIds:
							state.pullRequestWatch?.handledFeedbackIds ?? [],
					},
					pullRequestChecks: {
						headCommit: candidateCommit,
						status: "unknown",
						checks: [],
					},
				});
			}

			const verification = async () => {
				if (
					checkFindings.length === 0 &&
					agents.verifier &&
					!candidate.verification
				) {
					const declaredPaths = agents.verifier.artifacts ?? [];
					const key = `verifier:${state.repairRound}:${candidateCommit}:${state.verificationRetry ?? 0}`;
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
						`verifier:${state.repairRound}:${candidateCommit}:${state.verificationRetry ?? 0}`,
						`Verify the approved behavior by running the existing application and test harness using available tools. Search for and reuse the project's existing verification scripts. You may create gitignored scratch verification scripts and artifacts for supplemental checks, but do not modify approved tracked source, tests, or harness files. Do not fabricate screenshots or claim interactions you did not perform. Generate fresh screenshot or recording evidence at these gitignored worktree paths: ${JSON.stringify(declaredPaths)}. Before reporting a required gap, run additional non-mutating checks for uncovered approved behavior using the available harness and tools. Reuse existing command evidence; do not demand duplicate curl calls or an image for every transition when direct behavioral assertions establish it. Supply the declared fresh visual artifacts, and describe what each assertion actually proves. Report truly unavailable required capabilities and concrete unverified criteria in coverage.unverified, including what you tried; do not report an infrastructure gap as a code defect. ${responseFormat}\n\nAPPROVED BRIEF:\n${task.instructions}\nCANDIDATE COMMIT: ${candidateCommit}\nCHECK EVIDENCE:\n${JSON.stringify(checks)}\n\nREQUIRED GAPS FROM THE PREVIOUS VERIFICATION ATTEMPT:\n${JSON.stringify(state.verificationFeedback?.commit === candidateCommit ? state.verificationFeedback.verifier : [])}`,
						agents.verifier,
						"verifier",
						parseFactoryReview,
					);
					await assertFactoryCandidate({
						workspace: state.workspace,
						candidateCommit,
						signal,
					});
					let review = parseFactoryReview(response);
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
									unverified: [
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
				if (checkFindings.length === 0) {
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
								`Independently review this candidate against the approved brief. Search affected modules for existing helpers and equivalent operations, and read a representative implementation before judging departures. Assess correctness and maintainability separately, with concrete examples and a distinction between worthwhile cleanup and subjective style. Challenge duplicated logic, unnecessary abstractions or state, speculative compatibility, redundant defensive checks, opaque parameters, and avoidable branching. Identify the current requirement and smallest clearer behavior-preserving alternative. Review tests for distinct meaningful behavior and comments for intent, invariants, or protocol constraints rather than narration. Trace every changed return value, event payload, and persisted structure through producer -> transformation -> consumer, including tool-specific handlers, UI renderers, accounting, and restore/resume. Compare below/above thresholds, including built-in orchestration and external/custom tools. Verify actual user-visible consequences; distinguish static, exercised, and unverified coverage for this code-review role; behavioral execution belongs to the separate verifier. Do not claim you ran checks you did not run, and do not mark the lack of your own execution as a required gap. State that role limitation in summary; coverage.unverified contains only required static-review criteria you could not assess. Do not consult other reviewers' conclusions. Do not change files. Never treat passing tests as proof of correctness. ${responseFormat}\n\nAPPROVED BRIEF:\n${task.instructions}${input.repairInstructions ? `\n\nVerify this feedback without broadening scope:\n${input.repairInstructions}` : ""}\n\nCANDIDATE COMMIT: ${candidateCommit}\nCHECK EVIDENCE:\n${JSON.stringify(checks)}\n\nFULL DIFF:\n${diff}\n\nREQUIRED GAPS FROM YOUR PREVIOUS REVIEW ATTEMPT:\n${JSON.stringify(state.verificationFeedback?.commit === candidateCommit ? (state.verificationFeedback.reviewers.find((entry) => entry.reviewerIndex === reviewerIndex)?.gaps ?? []) : [])}`,
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
			]);
			for (const lane of lanes)
				if (lane.status === "rejected") throw lane.reason;
			const findings = [
				...checkFindings,
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
				candidate.reviews.length === agents.reviewers.length &&
				(!agents.verifier || candidate.verification)
			) {
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
				return {
					status: "completed",
					summary: `Verified candidate ${candidateCommit}. ${config.publishPullRequest ? "Draft pull request published; required current-head CI remains a separate gate." : "Changes ready for review; publishing is disabled."}`,
				};
			}
			const unverified = [
				...(candidate.verification?.review.coverage?.unverified ?? []),
				...candidate.reviews.flatMap(
					(entry) => entry.review.coverage?.unverified ?? [],
				),
			];
			if (unverified.length && !hasCodeFindings(candidate)) {
				save(
					retryUnavailableFactoryVerification(
						state,
						config.maxRuntimeRetries ?? 2,
					),
				);
				continue;
			}
			if (state.repairRound >= config.maxRepairRounds)
				throw new Error(
					`Repair limit (${config.maxRepairRounds}) reached.\n${findings.join("\n\n")}`,
				);
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
				repairInstructions,
				agents.implementer,
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

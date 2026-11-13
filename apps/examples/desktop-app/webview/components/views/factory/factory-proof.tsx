"use client";

import type {
	FactoryAcceptanceCriterion,
	FactoryAgent,
	FactoryRunState,
} from "@cline/shared";
import {
	evaluateFactoryAcceptance,
	FACTORY_PLAN_APPROVED_REASON,
	factoryIndependentReview,
	factoryRecordedReviewIndependence,
	factoryRepositoryRelative,
	factoryRunRoute,
} from "@cline/shared/browser";
import { CheckCircle2, CircleAlert, CircleSlash, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import {
	FACTORY_CARD,
	FACTORY_PROOF,
	FACTORY_ROLE_LABEL,
	FACTORY_STAGES,
	factoryShortModel,
} from "@/lib/factory-copy";
import { cn } from "@/lib/utils";
import {
	DetailsSummary,
	type FactoryTone,
	StatusPill,
	toneText,
} from "./factory-ui";

/**
 * Whether a requirement's own text says the build cannot check it ("the
 * build cannot check this", "not verifiable in CI", "manual check"). Such a
 * requirement is never shown as proven, whatever its check returned.
 */
export function factoryRequirementUncheckable(text: string): boolean {
	return (
		/\b(?:cannot|can ?not|can't|could not|couldn't|unable to|is not able to)\b[^.;\n]{0,60}\b(?:check|verif|test|prove|exercise|observe)/i.test(
			text,
		) ||
		/\bnot (?:be )?(?:checkable|verifiable|testable|provable|automatically (?:checked|verified|tested))\b/i.test(
			text,
		) ||
		/\b(?:un(?:checkable|verifiable|testable))\b/i.test(text) ||
		/\b(?:manual(?:ly)?|by hand|human)\s+(?:check|verif|test|review)/i.test(
			text,
		) ||
		/\boutside (?:the |of the )?(?:build|ci|checks?|test suite)\b/i.test(text)
	);
}

export type FactoryProofOutcome =
	| "passed"
	| "failed"
	| "unverified"
	| "uncheckable";

export type FactoryProofRequirement = {
	criterion: FactoryAcceptanceCriterion;
	outcome: FactoryProofOutcome;
	/** "Proven by check “api”", or by the tester. */
	how: string;
	evidence?: string;
};

export type FactoryProofChecker = {
	/** "Code reviewer", "Code reviewer 2", "Tester". */
	role: string;
	/** The model id, or undefined when the run did not record it. */
	model?: string;
	verdict?: "pass" | "changes_requested";
};

export type FactoryProofReceipt = {
	/** Undefined when the run named no requirements. */
	requirements?: FactoryProofRequirement[];
	proven: number;
	checks: { passed: number; total: number };
	/** "Also ran: Security scan, passed · …", when a repository stage ran. */
	stages?: string;
	checkedBy: FactoryProofChecker[];
	/** The builder's model, when recorded. */
	builderModel?: string;
	/** Whether a code reviewer runs on a model the builder does not. */
	independence: "independent" | "same" | "unknown";
	notChecked: string[];
	/** "2 reviewer findings left unresolved": its own block, not Not checked. */
	openFindings?: string;
	/** Checkers or builders whose model the run did not record. */
	modelGaps: string[];
	/** Why this route and what each station cost; absent without a review selection. */
	route?: string;
	/** Delivery asked nothing more because the person approved the plan. */
	planApproved?: string;
};

type ProofState = Pick<
	FactoryRunState,
	| "candidate"
	| "agents"
	| "attempts"
	| "inputSnapshot"
	| "unresolvedFindings"
	| "reviewSelection"
	| "reviewEscalation"
	| "sessions"
	| "sessionUsage"
	| "stagePlan"
	| "humanReview"
	| "planApprovedByPerson"
>;

type CardModel = { providerId?: string; modelId?: string } | undefined;

/**
 * The model an agent ran on, resolved only from what the run froze: the
 * agent's own model, then its profile's, then the card model the run was
 * started with (as core resolves it). Undefined when none was recorded.
 */
export function factoryFrozenModel(
	agent: FactoryAgent | undefined,
	cardModel: CardModel,
): string | undefined {
	const profile = agent?.resolvedProfile;
	const modelId =
		agent?.modelSelection?.modelId ??
		(profile?.modelId || profile?.providerId ? profile.modelId : undefined) ??
		cardModel?.modelId;
	return modelId?.trim() || undefined;
}

/** Numbered only when a role repeats. */
function numbered(label: string, index: number, total: number): string {
	return total > 1 ? `${label} ${index + 1}` : label;
}

/**
 * What a delivered run proved, who checked it on which model, and what was
 * not checked. Pure, so the home's one-line summary can reuse it.
 */
export function factoryProofReceipt({
	state,
	hasVerifier,
}: {
	state: ProofState;
	/** The card's workflow has a tester (verifier) agent. */
	hasVerifier: boolean;
}): FactoryProofReceipt {
	const candidate = state.candidate;
	const cardModel = state.inputSnapshot?.modelSelection;
	const criteria = state.inputSnapshot?.factory.acceptanceCriteria;
	const checks = candidate?.checks ?? [];
	const attemptOf = (sessionId: string) =>
		state.attempts?.find((attempt) => attempt.sessionId === sessionId);
	// What the session reported running on, else the frozen configuration.
	const attemptModel = (sessionId: string, agent: FactoryAgent | undefined) =>
		attemptOf(sessionId)?.sessionModel?.modelId ||
		factoryFrozenModel(attemptOf(sessionId)?.agent ?? agent, cardModel);

	const requirements = criteria?.length
		? evaluateFactoryAcceptance(
				criteria,
				candidate ?? { checks: [], verification: undefined },
			).map(({ criterion, outcome, evidence }): FactoryProofRequirement => {
				const uncheckable = factoryRequirementUncheckable(criterion.text);
				return {
					criterion,
					// A passing check cannot prove what its own text says it can't.
					outcome:
						uncheckable && outcome !== "failed" ? "uncheckable" : outcome,
					how: criterion.check
						? FACTORY_PROOF.byCheck(criterion.check)
						: FACTORY_PROOF.byTester,
					evidence,
				};
			})
		: undefined;

	const reviews = candidate?.reviews ?? [];
	const checkedBy: FactoryProofChecker[] = reviews.map((entry, index) => ({
		role: numbered(FACTORY_ROLE_LABEL.reviewer, index, reviews.length),
		model: attemptModel(
			entry.sessionId,
			state.agents?.reviewers[entry.reviewerIndex],
		),
		verdict: entry.review.verdict,
	}));
	const verification = candidate?.verification;
	if (verification)
		checkedBy.push({
			role: FACTORY_ROLE_LABEL.verifier,
			model: attemptModel(verification.sessionId, state.agents?.verifier),
			verdict: verification.review.verdict,
		});

	const builderAttempt = [...(state.attempts ?? [])]
		.reverse()
		.find((attempt) => attempt.role === "builder");
	const builderModel =
		builderAttempt?.sessionModel?.modelId ||
		factoryFrozenModel(
			builderAttempt?.agent ?? state.agents?.implementers[0],
			cardModel,
		);
	const reviewerModels = checkedBy
		.filter((checker) => checker.role !== FACTORY_ROLE_LABEL.verifier)
		.map((checker) => checker.model);
	// The models the sessions reported win over the configured ones.
	const recorded = factoryRecordedReviewIndependence(state);
	const independence: FactoryProofReceipt["independence"] = recorded
		? recorded.independent === undefined
			? "unknown"
			: recorded.independent
				? "independent"
				: "same"
		: !state.agents ||
				!builderModel ||
				!reviewerModels.length ||
				reviewerModels.some((model) => !model)
			? "unknown"
			: factoryIndependentReview(state.agents, cardModel).independent
				? "independent"
				: "same";
	const modelGaps = [
		...checkedBy.filter((checker) => !checker.model).map((item) => item.role),
		...(builderModel ? [] : [FACTORY_ROLE_LABEL.builder]),
	];

	const notChecked: string[] = [];
	if (!verification)
		notChecked.push(
			hasVerifier ? FACTORY_PROOF.testerNoResult : FACTORY_PROOF.noTester,
		);
	if (!checks.length) notChecked.push(FACTORY_PROOF.noChecks);
	for (const check of checks)
		if (check.status === "passed" && check.limitations?.length)
			notChecked.push(
				FACTORY_PROOF.checkLimitation(check.name, check.limitations),
			);
	for (const requirement of requirements ?? [])
		if (requirement.outcome === "uncheckable")
			notChecked.push(FACTORY_PROOF.uncheckable(requirement.criterion.text));
		else if (requirement.outcome === "unverified")
			notChecked.push(FACTORY_PROOF.notProven(requirement.criterion.text));
		else if (requirement.outcome === "failed")
			notChecked.push(FACTORY_PROOF.failed(requirement.criterion.text));
	const coverage = [
		...reviews.map((entry, index) => ({
			who: checkedBy[index]?.role ?? FACTORY_ROLE_LABEL.reviewer,
			coverage: entry.review.coverage,
		})),
		...(verification
			? [
					{
						who: FACTORY_ROLE_LABEL.verifier,
						coverage: verification.review.coverage,
					},
				]
			: []),
	];
	for (const { who, coverage: covered } of coverage) {
		for (const gap of covered?.requiredGaps ?? [])
			notChecked.push(FACTORY_PROOF.gap(who, factoryRepositoryRelative(gap)));
		for (const limitation of covered?.limitations ?? [])
			notChecked.push(
				FACTORY_PROOF.limitation(who, factoryRepositoryRelative(limitation)),
			);
	}
	// Repository stages: skipped by condition only shows on the Checks area.
	const stageResults = candidate?.stages ?? [];
	for (const stage of stageResults)
		if (stage.status === "error")
			notChecked.push(FACTORY_STAGES.couldNotRun(stage.name, stage.reason));
		else if (stage.status === "failed" && !stage.blocking)
			notChecked.push(
				FACTORY_STAGES.failedNotBlocking(stage.name, stage.reason),
			);
	for (const entry of state.stagePlan?.unapproved ?? [])
		notChecked.push(FACTORY_STAGES.notRun(entry.name, entry.reason));
	const ran = stageResults.filter(
		(stage) =>
			stage.status === "passed" ||
			stage.status === "failed" ||
			stage.status === "error",
	);
	const unresolved =
		state.unresolvedFindings?.findings.length ??
		reviews.reduce((count, entry) => count + entry.review.findings.length, 0);

	const route = factoryRunRoute(state);

	return {
		requirements,
		proven:
			requirements?.filter((requirement) => requirement.outcome === "passed")
				.length ?? 0,
		checks: {
			passed: checks.filter((check) => check.status === "passed").length,
			total: checks.length,
		},
		...(ran.length
			? {
					stages: FACTORY_STAGES.alsoRan(
						ran.map((stage) =>
							FACTORY_STAGES.item(
								stage.name,
								stage.access === "write" && stage.status === "passed"
									? FACTORY_STAGES.changed(stage.changedPaths?.length ?? 0)
									: FACTORY_STAGES.status[stage.status],
							),
						),
					),
				}
			: {}),
		checkedBy,
		builderModel,
		independence,
		notChecked,
		...(unresolved
			? { openFindings: FACTORY_PROOF.unresolved(unresolved) }
			: {}),
		modelGaps,
		...(route ? { route: FACTORY_PROOF.route(route) } : {}),
		// The PR's outcome is the card header's headline, not repeated here.
		...(state.planApprovedByPerson &&
		state.humanReview?.required === false &&
		state.humanReview.reason === FACTORY_PLAN_APPROVED_REASON
			? { planApproved: FACTORY_PROOF.planApproved }
			: {}),
	};
}

const OUTCOME_TONE: Record<
	FactoryProofOutcome,
	{ tone: FactoryTone; icon: typeof CheckCircle2 }
> = {
	passed: { tone: "success", icon: CheckCircle2 },
	failed: { tone: "danger", icon: XCircle },
	unverified: { tone: "attention", icon: CircleAlert },
	uncheckable: { tone: "neutral", icon: CircleSlash },
};

function Block({ label, children }: { label: string; children: ReactNode }) {
	return (
		<section aria-label={label} className="space-y-1.5">
			<h4 className="text-xs font-medium text-muted-foreground">{label}</h4>
			{children}
		</section>
	);
}

/**
 * The proof receipt on a delivered or review-needed card: Proven, Checked by,
 * Open findings (when a reviewer left any) and Not checked, then cost and agent runs in one quiet line. No block is
 * hidden for lack of good news. `children` (the feedback row) closes it.
 */
export function FactoryProof({
	state,
	hasVerifier,
	children,
	className,
}: {
	state: ProofState & Pick<FactoryRunState, "usage">;
	hasVerifier: boolean;
	children?: ReactNode;
	className?: string;
}) {
	const receipt = factoryProofReceipt({ state, hasVerifier });
	const { requirements } = receipt;
	const allProven = Boolean(
		requirements?.length && receipt.proven === requirements.length,
	);
	return (
		<section
			aria-label={FACTORY_PROOF.label}
			data-testid="factory-proof"
			className={cn("space-y-4 rounded-lg border bg-card px-5 py-4", className)}
		>
			<Block label={FACTORY_PROOF.proven}>
				{requirements ? (
					<p
						className="flex items-center gap-2 text-sm font-medium"
						data-testid="factory-proof-count"
					>
						{allProven ? (
							<CheckCircle2
								className={cn("size-4 shrink-0", toneText("success"))}
							/>
						) : (
							<CircleAlert
								className={cn("size-4 shrink-0", toneText("attention"))}
							/>
						)}
						{FACTORY_PROOF.provenCount(receipt.proven, requirements.length)}
					</p>
				) : (
					<p className="text-sm">{FACTORY_CARD.noCriterionResults}</p>
				)}
				{/* With no checks, NOT CHECKED says so. */}
				{receipt.checks.total ? (
					<p className="text-xs text-muted-foreground">
						{FACTORY_PROOF.checksPassed(
							receipt.checks.passed,
							receipt.checks.total,
						)}
					</p>
				) : null}
				{receipt.stages ? (
					<p
						className="text-xs text-muted-foreground"
						data-testid="factory-proof-stages"
					>
						{receipt.stages}
					</p>
				) : null}
				{requirements?.length ? (
					<details className="text-sm">
						<DetailsSummary>{FACTORY_PROOF.showEach}</DetailsSummary>
						<ul
							className="mt-2 divide-y rounded-lg border"
							data-testid="factory-proof-requirements"
						>
							{requirements.map((requirement) => {
								const style = OUTCOME_TONE[requirement.outcome];
								return (
									<li
										key={requirement.criterion.id}
										className="flex gap-2 px-3 py-2"
										data-outcome={requirement.outcome}
									>
										<style.icon
											className={cn(
												"mt-0.5 size-4 shrink-0",
												toneText(style.tone),
											)}
										/>
										<div className="min-w-0 flex-1 space-y-0.5">
											<div className="flex items-start justify-between gap-2">
												<span className="min-w-0 break-words">
													{requirement.criterion.text}
												</span>
												<StatusPill tone={style.tone}>
													{FACTORY_PROOF.outcome[requirement.outcome]}
												</StatusPill>
											</div>
											<p className="text-xs text-muted-foreground">
												{requirement.criterion.required
													? "Required"
													: "Optional"}{" "}
												· {requirement.how}
											</p>
										</div>
									</li>
								);
							})}
						</ul>
					</details>
				) : null}
			</Block>
			<Block label={FACTORY_PROOF.checkedBy}>
				{receipt.checkedBy.length ? (
					<ul
						className="space-y-0.5 text-sm"
						data-testid="factory-proof-checkers"
					>
						{receipt.checkedBy.map((checker) => (
							<li
								key={checker.role}
								className="break-words"
								title={checker.model}
							>
								{FACTORY_PROOF.agentLine(
									checker.role,
									checker.model
										? factoryShortModel(checker.model)
										: FACTORY_PROOF.modelNotRecorded,
									checker.verdict
										? FACTORY_PROOF.verdict[checker.verdict]
										: undefined,
								)}
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm">{FACTORY_PROOF.noCheckers}</p>
				)}
				{receipt.checkedBy.some(
					(checker) => checker.role !== FACTORY_ROLE_LABEL.verifier,
				) ? (
					<p
						className={cn(
							"text-xs",
							receipt.independence === "same"
								? toneText("attention")
								: "text-muted-foreground",
						)}
						data-testid="factory-proof-independence"
					>
						{receipt.independence === "independent"
							? FACTORY_PROOF.independent
							: receipt.independence === "same"
								? FACTORY_PROOF.sameModel
								: FACTORY_PROOF.independenceUnknown}
						{receipt.builderModel ? (
							<span title={receipt.builderModel}>
								{" "}
								{FACTORY_PROOF.builder(factoryShortModel(receipt.builderModel))}
							</span>
						) : null}
					</p>
				) : null}
			</Block>
			{receipt.openFindings ? (
				<Block label={FACTORY_PROOF.openFindings}>
					<p className="text-sm" data-testid="factory-proof-open-findings">
						{receipt.openFindings}
					</p>
				</Block>
			) : null}
			<Block label={FACTORY_PROOF.notChecked}>
				{receipt.notChecked.length ? (
					<ul
						className="list-disc space-y-0.5 pl-5 text-sm"
						data-testid="factory-proof-not-checked"
					>
						{receipt.notChecked.map((item, index) => (
							<li key={`${index}-${item}`} className="break-words">
								{item}
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">
						{allProven ? FACTORY_PROOF.nothingLeft : FACTORY_PROOF.nothing}
					</p>
				)}
			</Block>
			{receipt.planApproved ? (
				<p
					className="text-xs text-muted-foreground"
					data-testid="factory-proof-plan-approved"
				>
					{receipt.planApproved}
				</p>
			) : null}
			{receipt.route ? (
				<p
					className="text-xs text-muted-foreground"
					data-testid="factory-proof-route"
				>
					{receipt.route}
				</p>
			) : null}
			<p
				className="text-xs text-muted-foreground"
				data-testid="factory-proof-cost"
			>
				{FACTORY_CARD.costLine(
					state.usage
						? `$${state.usage.totals.totalCost.toFixed(2)}`
						: undefined,
					state.attempts?.length ?? 0,
					state.usage?.unknownSessionIds.length ?? 0,
				)}
			</p>
			{children}
		</section>
	);
}

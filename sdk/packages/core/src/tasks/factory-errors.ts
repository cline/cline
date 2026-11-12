import { FACTORY_PUBLISH_FAILURE_PREFIX } from "@cline/shared";

/**
 * A deliberate stop that needs a person: an exhausted repair or retry budget,
 * verification that stays unavailable, PR feedback only a maintainer can
 * confirm, or a configuration or candidate the Factory refuses to continue
 * from. Hands-off recovery never retries these.
 */
export class FactoryDecisionError extends Error {
	override name = "FactoryDecisionError";
}

/** Where a verification profile failed: a preflight stage, or writing it into the worktree. */
export type FactoryVerificationProfileStage =
	| "setup"
	| "start"
	| "healthcheck"
	| "worktree"
	| "write";

/**
 * A repository verification profile that cannot be used: its preflight
 * failed or Factory could not write it into the worktree. The fix is a new
 * profile from the designer or a person, so hands-off recovery never retries.
 */
export class FactoryVerificationProfileError extends FactoryDecisionError {
	override name = "FactoryVerificationProfileError";

	constructor(
		readonly stage: FactoryVerificationProfileStage,
		readonly detail: string,
	) {
		super(`Verification profile failed (${stage}): ${detail}`);
	}
}

/**
 * A plan whose checks or acceptance setup cannot work as written: an
 * artifact outside the worktree, a check bound to the original checkout.
 * No build can fix it, so no builder round is spent; Factory reopens scoping
 * with `findings` instead (see the task manager's plan-fault redesign).
 */
export class FactoryPlanConfigurationError extends FactoryDecisionError {
	override name = "FactoryPlanConfigurationError";

	constructor(
		readonly findings: string[],
		message = findings.join("\n"),
	) {
		super(message);
	}
}

/**
 * An approved plan that came with the request does not build: its checks at
 * the base commit all pass already or could not run (`reason`). The plan
 * goes back to scoping by the designer; no builder round was spent.
 */
export class FactoryPreparedBaseError extends FactoryDecisionError {
	override name = "FactoryPreparedBaseError";

	constructor(readonly reason: string) {
		super(reason);
	}
}

/**
 * Factory cannot open the draft PR for a reason only a person can fix: no
 * `origin` remote, the GitHub CLI missing or signed out, a base branch that
 * is not on the remote, or GitHub refusing the PR. The message is one
 * sentence saying what to do. Transient failures (network, rate limits) are
 * plain errors, so hands-off recovery may still retry those.
 */
export class FactoryPublishError extends FactoryDecisionError {
	override name = "FactoryPublishError";

	/** `reason` is the one sentence after the fixed prefix. */
	constructor(readonly reason: string) {
		super(`${FACTORY_PUBLISH_FAILURE_PREFIX}${reason}`);
	}
}

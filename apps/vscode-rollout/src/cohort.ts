export type Bundle = "next" | "legacy";

/** Loader-owned VS Code memento keys. Never touched by either bundle. */
export const COHORT_STATE_KEY = "cline.rollout.bundle";
export const KILLSWITCH_STATE_KEY = "cline.rollout.killswitch";
/** Version of the combined VSIX whose `next` bundle failed to activate, if any. */
export const FAILED_VERSION_STATE_KEY =
	"cline.rollout.nextActivationFailedVersion";

/** PostHog flags (created in the Cline PostHog project). */
export const ROLLOUT_FLAG = "ext-sdk-bundle-rollout";
export const KILLSWITCH_FLAG = "ext-sdk-bundle-killswitch";

/** Env var for local dev / e2e to force a bundle. */
export const BUNDLE_OVERRIDE_ENV = "CLINE_BUNDLE_OVERRIDE";

export interface CohortInputs {
	/** CLINE_BUNDLE_OVERRIDE, if set. */
	override: string | undefined;
	/** Cached assignment from the previous window's background flag refresh. */
	cached: string | undefined;
	/** Cached kill-switch state from the previous refresh. */
	killswitch: boolean;
	/** The next bundle failed to activate on this VSIX version before. */
	previousFailure: boolean;
}

/**
 * Decide which bundle to activate for this window. Must be synchronous and
 * never block on the network: it only consumes state cached by the previous
 * window's background refresh, so a percentage change or kill-switch applies
 * on the next window reload, mirroring how VS Code's own experiments behave.
 */
export function decideBundle(inputs: CohortInputs): Bundle {
	if (inputs.override === "next" || inputs.override === "legacy") {
		return inputs.override;
	}
	if (inputs.killswitch || inputs.previousFailure) {
		return "legacy";
	}
	return inputs.cached === "next" ? "next" : "legacy";
}

export interface RolloutFlags {
	rollout: boolean;
	killswitch: boolean;
}

/**
 * Compute the assignment to cache for the next window.
 *
 * One-way by design: once a machine is on `next`, dialing the rollout
 * percentage down does NOT move it back (tasks created on the SDK bundle are
 * invisible to the legacy bundle, and credentials rotated there don't flow
 * back). Only the explicit kill-switch flag demotes existing cohort members.
 */
export function nextCachedBundle(
	current: string | undefined,
	flags: RolloutFlags,
): Bundle {
	if (flags.killswitch) {
		return "legacy";
	}
	if (current === "next") {
		return "next";
	}
	return flags.rollout ? "next" : "legacy";
}

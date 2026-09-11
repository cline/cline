export type Bundle = "next" | "legacy";

/**
 * The combined VSIX ships under two identities: the stable extension
 * (manifest name "claude-dev", contribution IDs under "cline.*") and the
 * nightly (name "cline-nightly", IDs under "cline-nightly.*" — the nightly
 * packaging rewrites every `"cline.` prefix in the manifest, see
 * scripts/nightlify.mjs and apps/vscode/scripts/publish-nightly.mjs). Anything
 * the loader reads from or feeds back into the manifest namespace — the
 * bundleOverride setting and the sdkBundle context key — must use the prefix
 * matching the installed identity. scripts/gen-manifest.mjs derives the same
 * prefix when generating the union manifest; keep them in sync.
 */
export const NIGHTLY_EXTENSION_NAME = "cline-nightly";
export type IdPrefix = "cline" | "cline-nightly";

export function idPrefix(extensionName: string | undefined): IdPrefix {
	return extensionName === NIGHTLY_EXTENSION_NAME ? "cline-nightly" : "cline";
}

/** Settings section holding the bundleOverride escape hatch. */
export function settingSection(prefix: IdPrefix): string {
	return `${prefix}.rollout`;
}

/** Context key gating per-cohort menus/keybindings in the union manifest. */
export function bundleContextKey(prefix: IdPrefix): string {
	return `${prefix}.sdkBundle`;
}

/**
 * Loader-owned VS Code memento keys. Never touched by either bundle. These
 * deliberately stay un-prefixed by identity: globalState is already scoped to
 * the extension ID, so a stable and a nightly install can never collide.
 */
export const COHORT_STATE_KEY = "cline.rollout.bundle";
/** Version of the combined VSIX whose `next` bundle failed to activate, if any. */
export const FAILED_VERSION_STATE_KEY =
	"cline.rollout.nextActivationFailedVersion";
/** Epoch ms of the previous loader activation, for launch-cadence telemetry. */
export const LAST_ACTIVATION_STATE_KEY = "cline.rollout.lastActivationAt";

/**
 * PostHog rollout flag (created in the Cline PostHog project). Must be a
 * plain BOOLEAN release flag with a percentage rollout.
 *
 * The assignment is TWO-WAY: each background refresh caches exactly what the
 * flag says (true => next, anything else => legacy) for the next window, so
 * dialing the percentage down moves machines back to legacy on their next
 * reload — the single emergency lever is "set the rollout to 0%". Demoted
 * machines keep their settings/creds (the state files round-trip), but tasks
 * created on the SDK bundle aren't visible in legacy's history until
 * re-promoted, and tokens rotated on next may require re-auth on legacy.
 */
export const ROLLOUT_FLAG = "ext-sdk-bundle-rollout";

/** Env var for local dev / e2e to force a bundle. Beats everything. */
export const BUNDLE_OVERRIDE_ENV = "CLINE_BUNDLE_OVERRIDE";

/**
 * User-visible escape hatch: `<prefix>.rollout.bundleOverride` in VS Code
 * settings ("auto" | "next" | "legacy") — see settingSection() for the
 * identity-dependent section name. Editable from settings.json without
 * touching mementos, beats the remote flag in either direction, applies on
 * window reload. Injected into the union manifest by gen-manifest.mjs — keep
 * the schema there in sync with these constants.
 */
export const SETTING_BUNDLE_OVERRIDE = "bundleOverride";

function asBundle(value: unknown): Bundle | undefined {
	return value === "next" || value === "legacy" ? value : undefined;
}

export interface CohortInputs {
	/** CLINE_BUNDLE_OVERRIDE, if set. */
	envOverride: string | undefined;
	/** The <prefix>.rollout.bundleOverride user setting ("auto" = no override). */
	settingOverride: string | undefined;
	/** Cached assignment from the previous window's background flag refresh. */
	cached: string | undefined;
	/** The next bundle failed to activate on this VSIX version before. */
	previousFailure: boolean;
}

/**
 * Decide which bundle to activate for this window. Must be synchronous and
 * never block on the network: it only consumes state cached by the previous
 * window's background refresh, so a percentage change applies on the next
 * window reload, mirroring how VS Code's own experiments behave.
 */
export function decideBundle(inputs: CohortInputs): Bundle {
	const forced =
		asBundle(inputs.envOverride) ?? asBundle(inputs.settingOverride);
	if (forced) {
		return forced;
	}
	if (inputs.previousFailure) {
		return "legacy";
	}
	return inputs.cached === "next" ? "next" : "legacy";
}

/** Which override produced the decision, if any — reported on the activation event. */
export function decisionOverrideSource(
	inputs: Pick<CohortInputs, "envOverride" | "settingOverride">,
): "env" | "setting" | undefined {
	if (asBundle(inputs.envOverride)) {
		return "env";
	}
	if (asBundle(inputs.settingOverride)) {
		return "setting";
	}
	return undefined;
}

/**
 * Parse a PostHog /decide (v3) response into the assignment to cache for the
 * next window, or undefined when the response is malformed (leave the cached
 * assignment untouched — sticky on transient failures).
 *
 * Deliberately strict so a mis-configured flag fails SAFE toward legacy: only
 * boolean `true` promotes. A multivariate variant string, a number, a payload,
 * or a missing/deleted flag all resolve to legacy — the flag must stay a plain
 * boolean release flag with a percentage rollout.
 */
export function parseRolloutAssignment(response: unknown): Bundle | undefined {
	const flags = (
		response as { featureFlags?: Record<string, unknown> } | undefined
	)?.featureFlags;
	if (!flags || typeof flags !== "object") {
		return undefined;
	}
	return flags[ROLLOUT_FLAG] === true ? "next" : "legacy";
}

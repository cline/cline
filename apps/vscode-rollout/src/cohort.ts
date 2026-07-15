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
/**
 * Highest VSIX version the kill-switch applies to: a version string means
 * "demote every combined VSIX <= this version", "*" means all versions.
 * (The very first builds cached a boolean here; see normalizeKilledUpTo.)
 */
export const KILLSWITCH_STATE_KEY = "cline.rollout.killswitch";
/** Version of the combined VSIX whose `next` bundle failed to activate, if any. */
export const FAILED_VERSION_STATE_KEY =
	"cline.rollout.nextActivationFailedVersion";
/** Epoch ms of the previous loader activation, for launch-cadence telemetry. */
export const LAST_ACTIVATION_STATE_KEY = "cline.rollout.lastActivationAt";

/**
 * PostHog flags (created in the Cline PostHog project).
 *
 * - ROLLOUT_FLAG must be a plain BOOLEAN release flag with a percentage
 *   rollout. /decide returns `true` for enrolled machines; anything else
 *   (false, undefined, a multivariate variant string) deliberately does NOT
 *   promote — see parseRolloutFlags.
 * - KILLSWITCH_FLAG is a boolean flag whose PAYLOAD carries the demotion
 *   scope: {"maxKilledVersion": "4.1.2"} demotes combined VSIXes <= 4.1.2
 *   only, so a fixed 4.1.3 can roll out while broken older installs stay
 *   pinned to legacy. Enabling it with no payload demotes ALL versions.
 */
export const ROLLOUT_FLAG = "ext-sdk-bundle-rollout";
export const KILLSWITCH_FLAG = "ext-sdk-bundle-killswitch";

/** Env var for local dev / e2e to force a bundle. Beats everything. */
export const BUNDLE_OVERRIDE_ENV = "CLINE_BUNDLE_OVERRIDE";

/**
 * User-visible escape hatch: `<prefix>.rollout.bundleOverride` in VS Code
 * settings ("auto" | "next" | "legacy") — see settingSection() for the
 * identity-dependent section name. Editable from settings.json without
 * touching mementos, beats flags/kill-switch in either direction, applies on
 * window reload. Injected into the union manifest by gen-manifest.mjs — keep
 * the schema there in sync with these constants.
 */
export const SETTING_BUNDLE_OVERRIDE = "bundleOverride";

function asBundle(value: unknown): Bundle | undefined {
	return value === "next" || value === "legacy" ? value : undefined;
}

/**
 * Compare dotted numeric versions (pre-release suffixes ignored: "4.1.0-rc1"
 * compares as 4.1.0). Returns <0, 0, >0 like a comparator.
 */
export function compareVersions(a: string, b: string): number {
	const parse = (v: string) =>
		v
			.split("-")[0]
			.split(".")
			.map((part) => Number.parseInt(part, 10) || 0);
	const pa = parse(a);
	const pb = parse(b);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) {
			return diff;
		}
	}
	return 0;
}

export function isVersionKilled(
	version: string,
	killedUpToVersion: string | undefined,
): boolean {
	if (!killedUpToVersion) {
		return false;
	}
	if (killedUpToVersion === "*") {
		return true;
	}
	return compareVersions(version, killedUpToVersion) <= 0;
}

/**
 * Read a cached kill-switch memento defensively: current builds store a
 * version string (or "*"); the very first builds stored a boolean.
 */
export function normalizeKilledUpTo(value: unknown): string | undefined {
	if (value === true) {
		return "*";
	}
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export interface CohortInputs {
	/** CLINE_BUNDLE_OVERRIDE, if set. */
	envOverride: string | undefined;
	/** The cline.rollout.bundleOverride user setting ("auto" = no override). */
	settingOverride: string | undefined;
	/** Cached assignment from the previous window's background flag refresh. */
	cached: string | undefined;
	/** Cached kill-switch scope from the previous refresh (see KILLSWITCH_STATE_KEY). */
	killedUpToVersion: string | undefined;
	/** The next bundle failed to activate on this VSIX version before. */
	previousFailure: boolean;
	/** This combined VSIX's version, compared against the kill-switch scope. */
	version: string;
}

/**
 * Decide which bundle to activate for this window. Must be synchronous and
 * never block on the network: it only consumes state cached by the previous
 * window's background refresh, so a percentage change or kill-switch applies
 * on the next window reload, mirroring how VS Code's own experiments behave.
 */
export function decideBundle(inputs: CohortInputs): Bundle {
	const forced =
		asBundle(inputs.envOverride) ?? asBundle(inputs.settingOverride);
	if (forced) {
		return forced;
	}
	if (
		isVersionKilled(inputs.version, inputs.killedUpToVersion) ||
		inputs.previousFailure
	) {
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

export interface RolloutFlags {
	rollout: boolean;
	/** Kill-switch scope: version string, "*" for all, undefined when off. */
	killedUpToVersion: string | undefined;
}

/**
 * Parse a PostHog /decide (v3) response into rollout flags.
 *
 * Deliberately strict about types so a mis-configured flag fails SAFE
 * (nobody promoted; demotion only when the kill-switch is explicitly armed):
 * - rollout: only boolean `true` promotes. A multivariate variant string, a
 *   number, or a payload does not — the flag must stay a plain boolean
 *   release flag with a percentage rollout.
 * - kill-switch: any truthy value arms it; the scope comes from the payload's
 *   maxKilledVersion (JSON payloads arrive as strings from /decide). An armed
 *   kill-switch with no/invalid payload means "all versions".
 */
export function parseRolloutFlags(response: unknown): RolloutFlags | undefined {
	const payload = response as
		| {
				featureFlags?: Record<string, unknown>;
				featureFlagPayloads?: Record<string, unknown>;
		  }
		| undefined;
	const flags = payload?.featureFlags;
	if (!flags || typeof flags !== "object") {
		return undefined;
	}

	let killedUpToVersion: string | undefined;
	if (flags[KILLSWITCH_FLAG]) {
		killedUpToVersion = "*";
		const rawKillPayload = payload?.featureFlagPayloads?.[KILLSWITCH_FLAG];
		const killPayload =
			typeof rawKillPayload === "string"
				? safeJsonParse(rawKillPayload)
				: rawKillPayload;
		const max = (killPayload as { maxKilledVersion?: unknown } | undefined)
			?.maxKilledVersion;
		if (typeof max === "string" && max.length > 0) {
			killedUpToVersion = max;
		}
	}

	return { rollout: flags[ROLLOUT_FLAG] === true, killedUpToVersion };
}

function safeJsonParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

/**
 * Compute the assignment to cache for the next window.
 *
 * One-way by design: once a machine is on `next`, dialing the rollout
 * percentage down does NOT move it back (tasks created on the SDK bundle are
 * invisible to the legacy bundle, and credentials rotated there don't flow
 * back). Only the explicit kill-switch demotes existing cohort members, and
 * only for VSIX versions inside its scope — a fixed release above
 * maxKilledVersion re-promotes via the rollout flag as usual.
 */
export function nextCachedBundle(
	current: string | undefined,
	flags: RolloutFlags,
	version: string,
): Bundle {
	if (isVersionKilled(version, flags.killedUpToVersion)) {
		return "legacy";
	}
	if (current === "next") {
		return "next";
	}
	return flags.rollout ? "next" : "legacy";
}

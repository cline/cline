/**
 * Internal-feature gating, shared by every SDK client.
 *
 * An "internal feature" ships in production builds but is offered only to
 * internal users — accounts signed in with an email on
 * {@link INTERNAL_USER_EMAIL_DOMAINS} (i.e. `@cline.bot`) — plus, as an
 * escape hatch, anyone the feature's matching feature flag is enabled for,
 * so access can be widened per-cohort from PostHog without a release.
 *
 * Clients resolve access through {@link isInternalFeatureEnabled} (or the
 * `FeatureFlagsService.isInternalFeatureEnabled` wrapper in `@cline/core`),
 * supplying the signed-in account email from their own auth source. No email
 * means no domain-based access: the gate fails closed for signed-out and
 * unknown accounts.
 */

/** Email domains whose signed-in accounts count as internal users. */
export const INTERNAL_USER_EMAIL_DOMAINS = ["cline.bot"] as const;

/**
 * Whether an account email belongs to an internal user. Exact-domain match
 * only: subdomains (`x@team.cline.bot`) and lookalikes (`x@notcline.bot`) do
 * not qualify, and a missing or malformed email never does.
 */
export function isInternalUserEmail(email: string | null | undefined): boolean {
	const normalized = email?.trim().toLowerCase();
	if (!normalized) {
		return false;
	}
	const atIndex = normalized.lastIndexOf("@");
	if (atIndex <= 0 || atIndex === normalized.length - 1) {
		return false;
	}
	const domain = normalized.slice(atIndex + 1);
	return (INTERNAL_USER_EMAIL_DOMAINS as readonly string[]).includes(domain);
}

/**
 * Registry of internal features. Each value doubles as the feature-flag key
 * that widens access beyond the internal email domains, so every entry here
 * must also be registered in the `FeatureFlag` registry
 * (`feature-flags.ts`) — that is what makes providers poll it.
 */
export const InternalFeature = {
	/** Composio-backed connectors (Gmail, Google Calendar, GitHub, catalog). */
	COMPOSIO_CONNECTORS: "internal-composio-connectors",
} as const;

export type InternalFeature =
	(typeof InternalFeature)[keyof typeof InternalFeature];

/**
 * Whether an internal feature is available: the signed-in account is an
 * internal user, or the feature's flag is enabled for it. Both inputs are
 * optional so the gate degrades safely — with neither, access is denied.
 */
export function isInternalFeatureEnabled(
	feature: InternalFeature,
	access: {
		/** Signed-in account email, when known. */
		email?: string | null;
		/** Resolves the boolean feature flag named by `feature`, when a flag
		 * provider is available. */
		isFlagEnabled?: (flagKey: string) => boolean;
	},
): boolean {
	if (isInternalUserEmail(access.email)) {
		return true;
	}
	return access.isFlagEnabled?.(feature) === true;
}

/**
 * Canonical list of OAuth provider IDs managed by the platform.
 * Derive sets, types, and guards from this single source of truth.
 */
export const OAUTH_PROVIDER_IDS = ["cline", "oca", "openai-codex"] as const;

export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];

/**
 * Check whether a provider ID is a managed OAuth provider.
 */
export function isOAuthProviderId(
	providerId: string,
): providerId is OAuthProviderId {
	return (OAUTH_PROVIDER_IDS as readonly string[]).includes(providerId);
}

/**
 * Error‑message sub-strings that indicate an auth / credential failure.
 * Used to decide whether a failed API call should trigger an OAuth refresh.
 */
export const AUTH_ERROR_PATTERNS = [
	"401",
	"403",
	"unauthorized",
	"forbidden",
	"invalid token",
	"expired token",
	"authentication",
] as const;

/**
 * Returns `true` when `error` looks like an authentication failure
 * *and* the provider is a managed OAuth provider.
 */
export function isLikelyAuthError(error: unknown, providerId: string): boolean {
	if (!isOAuthProviderId(providerId)) return false;
	const message =
		error instanceof Error ? error.message.toLowerCase() : String(error);
	return AUTH_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

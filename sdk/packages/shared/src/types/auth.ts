/**
 * Error‑message sub-strings that indicate an auth / credential failure.
 * Used with provider auth handlers to decide whether a failed API call should
 * trigger an OAuth refresh.
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
 * Returns `true` when `error` looks like an authentication failure.
 */
export function isLikelyAuthError(error: unknown): boolean {
	const message = (
		error instanceof Error ? error.message : String(error)
	).toLowerCase();
	return AUTH_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

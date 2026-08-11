/**
 * Enum defining different reasons why a user might be logged out
 * Used for telemetry tracking to understand logout patterns
 *
 * Kept structurally identical to the SDK auth service's LogoutReason
 * (src/sdk/auth-service.ts) so values can be passed across the two.
 */
export enum LogoutReason {
	/** User explicitly clicked logout button in UI */
	USER_INITIATED = "user_initiated",
	/** Auth tokens were cleared in another VSCode window (cross-window sync) */
	CROSS_WINDOW_SYNC = "cross_window_sync",
	/**
	 * @deprecated No longer emitted; it conflated startup-with-no-session with
	 * real involuntary logouts. Kept so historical warehouse data stays
	 * interpretable.
	 */
	ERROR_RECOVERY = "error_recovery",
	/**
	 * Stored credentials were destroyed because the refresh token was rejected
	 * (invalid grant — re-auth required). A real involuntary logout.
	 */
	TOKEN_INVALID = "token_invalid",
	/**
	 * Emitted only by the legacy bundle: activation with no stored Cline
	 * session (not a logout).
	 */
	NO_STORED_SESSION = "no_stored_session",
	/** Restoring the stored session on activation threw an unexpected error */
	RESTORE_ERROR = "restore_error",
	/** Unknown or unspecified reason */
	UNKNOWN = "unknown",
}

/**
 * Enum defining different reasons why a user might be logged out
 * Used for telemetry tracking to understand logout patterns
 */
export enum LogoutReason {
	/** User explicitly clicked logout button in UI */
	USER_INITIATED = "user_initiated",
	/** Auth tokens were cleared in another VSCode window (cross-window sync) */
	CROSS_WINDOW_SYNC = "cross_window_sync",
	/**
	 * @deprecated No longer emitted. Historically this one value conflated three
	 * situations that are now reported separately: NO_STORED_SESSION (the
	 * overwhelming majority — not a logout at all), TOKEN_INVALID and
	 * RESTORE_ERROR. Kept so historical warehouse data stays interpretable.
	 */
	ERROR_RECOVERY = "error_recovery",
	/**
	 * The stored session was destroyed because the refresh token was rejected as
	 * invalid/expired (or the stored auth blob was unusable). This is a real
	 * involuntary logout: the user was signed in and now must re-authenticate.
	 */
	TOKEN_INVALID = "token_invalid",
	/**
	 * The extension activated with no stored Cline session (e.g. API-key users
	 * who never signed in). Emitted on every window open for the signed-out
	 * population — NOT a logout; exclude it when measuring logouts.
	 */
	NO_STORED_SESSION = "no_stored_session",
	/** Restoring the stored session on activation threw an unexpected error */
	RESTORE_ERROR = "restore_error",
	/** Unknown or unspecified reason */
	UNKNOWN = "unknown",
}

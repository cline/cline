/**
 * Enum defining different reasons why a user might be logged out
 * Used for telemetry tracking to understand logout patterns
 */
export enum LogoutReason {
	/** User explicitly clicked logout button in UI */
	USER_INITIATED = "user_initiated",
	/** Auth tokens were cleared in another VSCode window (cross-window sync) */
	CROSS_WINDOW_SYNC = "cross_window_sync",
	/** @deprecated No longer emitted — split into NO_STORED_SESSION / TOKEN_INVALID / RESTORE_ERROR */
	ERROR_RECOVERY = "error_recovery",
	/** Refresh token rejected as invalid/expired — a real involuntary logout */
	TOKEN_INVALID = "token_invalid",
	/** Activated with no stored Cline session (e.g. API-key users) — not a logout */
	NO_STORED_SESSION = "no_stored_session",
	/** Restoring the stored session on activation threw an error */
	RESTORE_ERROR = "restore_error",
	/** Unknown or unspecified reason */
	UNKNOWN = "unknown",
}

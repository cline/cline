/**
 * Enum defining different reasons why a user might be logged out
 * Used for telemetry tracking to understand logout patterns
 *
 * Single source for the user.auth_logged_out reason vocabulary — the SDK
 * auth service (src/sdk/auth-service.ts) re-exports this enum.
 */
export enum LogoutReason {
	/** User explicitly clicked logout button in UI */
	USER_INITIATED = "user_initiated",
	/** Auth tokens were cleared in another VSCode window (cross-window sync) */
	CROSS_WINDOW_SYNC = "cross_window_sync",
	/** Auth provider encountered an error and cleared tokens */
	ERROR_RECOVERY = "error_recovery",
	/**
	 * Refresh token rejected as invalid/expired — a real involuntary logout.
	 * For the SDK auth service this value is emitted by the SDK credential
	 * resolver (getValidClineCredentials), the single owner of that event.
	 */
	TOKEN_INVALID = "token_invalid",
	/** Restoring the stored session on activation threw an unexpected error */
	RESTORE_ERROR = "restore_error",
	/** Unknown or unspecified reason */
	UNKNOWN = "unknown",
}

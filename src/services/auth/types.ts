/**
 * Enum defining different reasons why a user might be logged out
 * Used for telemetry tracking to understand logout patterns
 */
export enum LogoutReason {
	/** User explicitly clicked logout button in UI */
	USER_INITIATED = "user_initiated",
	/** Auth tokens were cleared in another VSCode window (cross-window sync) */
	CROSS_WINDOW_SYNC = "cross_window_sync",
	/** Auth provider encountered an error and cleared tokens */
	ERROR_RECOVERY = "error_recovery",
	/** Unknown or unspecified reason */
	UNKNOWN = "unknown",
}

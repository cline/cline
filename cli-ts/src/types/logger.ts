/**
 * Logger interface for CLI output
 */
export interface Logger {
	/** Log debug messages (only shown when verbose=true) */
	debug(message: string, ...args: unknown[]): void
	/** Log informational messages */
	info(message: string, ...args: unknown[]): void
	/** Log warning messages */
	warn(message: string, ...args: unknown[]): void
	/** Log error messages */
	error(message: string, ...args: unknown[]): void
}

/**
 * Log level enum for internal use
 */
export enum LogLevel {
	DEBUG = "debug",
	INFO = "info",
	WARN = "warn",
	ERROR = "error",
}

/**
 * Interface for error providers
 * Allows switching between different error tracking providers (PostHog, Sentry, etc.)
 */

import type { ClineError } from "../ClineError"

/**
 * Error settings that control when and how errors are logged
 */
export interface ErrorSettings {
	/** Whether error logging is enabled */
	enabled: boolean
	/** Whether the host environment's telemetry is enabled */
	hostEnabled: boolean
	/** The level of errors to log */
	level?: "all" | "off" | "error" | "crash"
}

/**
 * Abstract interface for error providers
 * Any error tracking provider must implement this interface
 */
export interface IErrorProvider {
	/**
	 * Log an exception with error details
	 * @param error The error to log (Error or ClineError)
	 * @param properties Optional additional properties to attach
	 */
	logException(error: Error | ClineError, properties?: Record<string, unknown>): void

	/**
	 * Log a message with specified level
	 * @param message The message to log
	 * @param level The severity level of the message
	 * @param properties Optional additional properties to attach
	 */
	logMessage(
		message: string,
		level?: "error" | "warning" | "log" | "debug" | "info",
		properties?: Record<string, unknown>,
	): void

	/**
	 * Check if error logging is currently enabled
	 */
	isEnabled(): boolean

	/**
	 * Get current error logging settings
	 */
	getSettings(): ErrorSettings

	/**
	 * Clean up resources when the provider is disposed
	 */
	dispose(): Promise<void>
}

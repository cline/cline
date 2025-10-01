/**
 * Interface for telemetry providers
 * Allows switching between different analytics providers (PostHog, etc.)
 */

import type { ClineAccountUserInfo } from "../../auth/AuthService"

/**
 * Telemetry settings that control when and how telemetry is collected
 */
export interface TelemetrySettings {
	/** Whether the extension's telemetry is enabled */
	extensionEnabled: boolean
	/** Whether the host environment's telemetry is enabled */
	hostEnabled: boolean
	/** The level of telemetry to collect */
	level?: "all" | "off" | "error" | "crash"
}

/**
 * Abstract interface for telemetry providers
 * Any analytics provider must implement this interface
 */
export interface ITelemetryProvider {
	/**
	 * Log an event with optional properties
	 * @param event The event name to log
	 * @param properties Optional properties to attach to the event
	 */
	log(event: string, properties?: Record<string, unknown>): void

	/**
	 * Identify a user for tracking
	 * @param userInfo The user's information
	 * @param properties Optional additional properties
	 */
	identifyUser(userInfo: ClineAccountUserInfo, properties?: Record<string, unknown>): void

	/**
	 * Update telemetry opt-in/out status
	 * @param optIn Whether the user has opted into telemetry
	 */
	setOptIn(optIn: boolean): void

	/**
	 * Check if telemetry is currently enabled
	 */
	isEnabled(): boolean

	/**
	 * Get current telemetry settings
	 */
	getSettings(): TelemetrySettings

	/**
	 * Clean up resources when the provider is disposed
	 */
	dispose(): Promise<void>
}

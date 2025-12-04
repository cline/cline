/**
 * Interface for telemetry providers
 * Allows switching between different analytics providers (PostHog, etc.)
 */

import type { ClineAccountUserInfo } from "../../auth/AuthService"

/**
 * JSON-serializable primitive types for telemetry properties
 */
export type TelemetryPrimitive = string | number | boolean | null | undefined

/**
 * JSON-serializable value types for telemetry properties
 * Ensures all telemetry data can be properly serialized
 */
export type TelemetryValue = TelemetryPrimitive | TelemetryObject | TelemetryArray

/**
 * JSON-serializable object for telemetry properties
 */
export type TelemetryObject = { [key: string]: TelemetryValue }

/**
 * JSON-serializable array for telemetry properties
 */
export type TelemetryArray = Array<TelemetryValue>

/**
 * Properties that can be safely passed to telemetry providers
 */
export type TelemetryProperties = TelemetryObject

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
	 * @param properties Optional JSON-serializable properties to attach to the event
	 */
	log(event: string, properties?: TelemetryProperties): void

	/**
	 * Log a required event that bypasses telemetry opt-out settings
	 * Required events are critical for system health and error monitoring
	 * @param event The event name to log
	 * @param properties Optional JSON-serializable properties to attach to the event
	 */
	logRequired(event: string, properties?: TelemetryProperties): void

	/**
	 * Identify a user for tracking
	 * @param userInfo The user's information
	 * @param properties Optional additional JSON-serializable properties
	 */
	identifyUser(userInfo: ClineAccountUserInfo, properties?: TelemetryProperties): void

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
	 * Returns the name of the telemetry provider.
	 */
	name(): string

	/**
	 * Record a counter metric (cumulative value that only increases)
	 * Providers that don't support metrics may implement this as a no-op.
	 * @param name Metric name (e.g., "cline.tokens.input")
	 * @param value Amount to increment by (default 1)
	 * @param attributes Optional metric attributes including userId, ulid (JSON-serializable)
	 */
	recordCounter(name: string, value: number, attributes?: TelemetryProperties, description?: string, required?: boolean): void

	/**
	 * Record a histogram metric (distribution of values for percentile analysis)
	 * Providers that don't support metrics may implement this as a no-op.
	 * @param name Metric name (e.g., "cline.api.duration_seconds")
	 * @param value Value to record
	 * @param attributes Optional metric attributes including userId, ulid (JSON-serializable)
	 */
	recordHistogram(name: string, value: number, attributes?: TelemetryProperties, description?: string, required?: boolean): void

	/**
	 * Record a gauge metric (point-in-time value that can go up or down)
	 * Providers that don't support metrics may implement this as a no-op.
	 * @param name Metric name (e.g., "cline.workspace.active_roots")
	 * @param value Current value, or null to retire the series identified by name + attributes
	 * @param attributes Optional metric attributes including userId, ulid (JSON-serializable). When retiring a series pass the same attribute set that was used when recording it.
	 */
	recordGauge(
		name: string,
		value: number | null,
		attributes?: TelemetryProperties,
		description?: string,
		required?: boolean,
	): void

	/**
	 * Clean up resources when the provider is disposed
	 */
	dispose(): Promise<void>
}

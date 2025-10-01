import type { TelemetryProperties } from "../providers/ITelemetryProvider"
import type { TelemetryService } from "../TelemetryService"
import { EventHandlerBase } from "./EventHandlerBase"

/**
 * Property types for user telemetry events
 */

export interface UserOptOutProperties extends TelemetryProperties {}

export interface TelemetryEnabledProperties extends TelemetryProperties {}

export interface ExtensionActivatedProperties extends TelemetryProperties {}

/**
 * Event handler for user-related telemetry events
 */
export class UserEvents extends EventHandlerBase {
	static override readonly prefix = "user"

	/**
	 * Records when a user opts out of telemetry
	 * @param service The telemetry service instance
	 */
	static captureUserOptOut(service: TelemetryService): void {
		const properties: UserOptOutProperties = {}
		UserEvents.captureRequired(service, "user.opt_out", properties)
	}

	/**
	 * Records when telemetry is enabled
	 * @param service The telemetry service instance
	 */
	static captureTelemetryEnabled(service: TelemetryService): void {
		const properties: TelemetryEnabledProperties = {}
		UserEvents.capture(service, "user.telemetry_enabled", properties)
	}

	/**
	 * Records when the extension is activated
	 * @param service The telemetry service instance
	 */
	static captureExtensionActivated(service: TelemetryService): void {
		const properties: ExtensionActivatedProperties = {}
		UserEvents.capture(service, "user.extension_activated", properties)
	}
}

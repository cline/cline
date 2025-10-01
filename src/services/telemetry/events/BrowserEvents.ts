import type { BrowserSettings } from "@shared/BrowserSettings"
import type { TelemetryProperties } from "../providers/ITelemetryProvider"
import type { TelemetryService } from "../TelemetryService"
import { EventHandlerBase } from "./EventHandlerBase"

/**
 * Property types for browser telemetry events
 */

export interface BrowserToolStartProperties extends TelemetryProperties {
	ulid: string
	viewport?: { width: number; height: number }
	isRemote: boolean
	remoteBrowserHost?: string
	timestamp: string
}

export interface BrowserErrorProperties extends TelemetryProperties {
	ulid: string
	errorType: string
	errorMessage: string
	action?: string
	url?: string
	isRemote?: boolean
	remoteBrowserHost?: string
	endpoint?: string
	timestamp: string
}

export interface BrowserToolEndProperties extends TelemetryProperties {
	ulid: string
	actionCount: number
	duration: number
	actions?: string[]
	timestamp: string
}

/**
 * Event handler for browser-related telemetry events
 */
export class BrowserEvents extends EventHandlerBase {
	static override readonly prefix = "browser"

	/**
	 * Records when the browser tool is started
	 * @param service The telemetry service instance
	 * @param ulid Unique identifier for the task
	 * @param browserSettings The browser settings being used
	 */
	static captureBrowserToolStart(service: TelemetryService, ulid: string, browserSettings: BrowserSettings): void {
		const properties: BrowserToolStartProperties = {
			ulid,
			viewport: browserSettings.viewport,
			isRemote: !!browserSettings.remoteBrowserEnabled,
			remoteBrowserHost: browserSettings.remoteBrowserHost,
			timestamp: new Date().toISOString(),
		}
		BrowserEvents.capture(service, "task.browser_tool_start", properties)
	}

	/**
	 * Records when browser errors occur during a task
	 * @param service The telemetry service instance
	 * @param ulid Unique identifier for the task
	 * @param errorType Type of error that occurred
	 * @param errorMessage The error message
	 * @param context Additional context about where the error occurred
	 */
	static captureBrowserError(
		service: TelemetryService,
		ulid: string,
		errorType: string,
		errorMessage: string,
		context?: Partial<BrowserErrorProperties>,
	): void {
		const properties: BrowserErrorProperties = {
			ulid,
			errorType,
			errorMessage,
			timestamp: new Date().toISOString(),
			...context,
		}
		BrowserEvents.capture(service, "task.browser_error", properties)
	}

	/**
	 * Records when the browser tool is completed
	 * @param service The telemetry service instance
	 * @param ulid Unique identifier for the task
	 * @param stats Statistics about the browser session
	 */
	static captureBrowserToolEnd(
		service: TelemetryService,
		ulid: string,
		stats: {
			actionCount: number
			duration: number
			actions?: string[]
		},
	): void {
		const properties: BrowserToolEndProperties = {
			ulid,
			actionCount: stats.actionCount,
			duration: stats.duration,
			actions: stats.actions,
			timestamp: new Date().toISOString(),
		}
		BrowserEvents.capture(service, "task.browser_tool_end", properties)
	}
}

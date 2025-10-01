import type { TelemetryObject } from "../providers/ITelemetryProvider"
import type { TelemetryService } from "../TelemetryService"

/**
 * Base class for telemetry event handlers
 * Provides common functionality for event capture with metadata enrichment
 */
export abstract class EventHandlerBase {
	/** Event prefix for this handler (e.g., "task", "ui", "dictation") */
	static readonly prefix: string

	/**
	 * Capture a regular telemetry event
	 * @param service The telemetry service instance
	 * @param event The full event name (e.g., "task.created")
	 * @param properties Event properties
	 * @param required Whether this is a required event that bypasses user preferences
	 */
	protected static capture(
		service: TelemetryService,
		event: string,
		properties?: TelemetryObject,
		required: boolean = false,
	): void {
		if (required) {
			service.captureRequired(event, properties)
		} else {
			service.capture({ event, properties })
		}
	}

	/**
	 * Capture a required event that bypasses telemetry opt-out settings
	 * @param service The telemetry service instance
	 * @param event The full event name
	 * @param properties Event properties
	 */
	protected static captureRequired(service: TelemetryService, event: string, properties?: TelemetryObject): void {
		service.captureRequired(event, properties)
	}

	/**
	 * Check if telemetry is enabled for regular events
	 * @param service The telemetry service instance
	 * @returns Whether telemetry is enabled
	 */
	protected static isEnabled(service: TelemetryService): boolean {
		return service.isEnabled()
	}
}

/**
 * Registry for automatic event handler registration
 */
export class EventHandlerRegistry {
	private static handlers: Map<string, typeof EventHandlerBase> = new Map()
	private static registered = false

	/**
	 * Register an event handler for a specific prefix
	 * @param prefix The event prefix (e.g., "task", "ui")
	 * @param handlerClass The handler class
	 */
	static register(prefix: string, handlerClass: typeof EventHandlerBase): void {
		EventHandlerRegistry.handlers.set(prefix, handlerClass)
	}

	/**
	 * Get a registered event handler by prefix
	 * @param prefix The event prefix
	 * @returns The handler class or undefined
	 */
	static getHandler(prefix: string): typeof EventHandlerBase | undefined {
		return EventHandlerRegistry.handlers.get(prefix)
	}

	/**
	 * Auto-register all event handlers
	 * This is called once during TelemetryService initialization
	 */
	static registerAll(): void {
		if (EventHandlerRegistry.registered) return

		// Import and register all handlers
		// This will be populated as we create the specific handlers
		EventHandlerRegistry.registered = true
	}

	/**
	 * Get all registered prefixes
	 * @returns Array of registered event prefixes
	 */
	static getRegisteredPrefixes(): string[] {
		return Array.from(EventHandlerRegistry.handlers.keys())
	}
}

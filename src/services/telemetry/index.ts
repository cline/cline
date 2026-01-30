export type {
	ITelemetryProvider,
	TelemetrySettings,
} from "./providers/ITelemetryProvider"
export { PostHogTelemetryProvider } from "./providers/posthog/PostHogTelemetryProvider"
export {
	type TelemetryProviderConfig,
	TelemetryProviderFactory,
	type TelemetryProviderType,
} from "./TelemetryProviderFactory"
// Export terminal type definitions for type-safe telemetry
export type {
	StandaloneOutputMethod,
	TerminalOutputMethod,
	TerminalType,
	VscodeOutputMethod,
} from "./TelemetryService"
// Export the enums and types for terminal telemetry
export {
	TerminalHangStage,
	TerminalOutputFailureReason,
	TerminalUserInterventionAction,
} from "./TelemetryService"

// Create a singleton instance for easy access throughout the application
import { TelemetryService } from "./TelemetryService"

let _telemetryServiceInstance: TelemetryService | null = null
let _initializationPromise: Promise<TelemetryService> | null = null

/**
 * Get the singleton telemetry service instance
 * @param distinctId Optional distinct ID for the telemetry provider
 * @returns TelemetryService instance
 */
export async function getTelemetryService(): Promise<TelemetryService> {
	if (_telemetryServiceInstance) {
		return _telemetryServiceInstance
	}

	// If initialization is already in progress, wait for it to complete
	if (_initializationPromise) {
		return _initializationPromise
	}

	// Start initialization and store the promise to prevent concurrent initialization.
	// Ensure that on failure we reset the initialization promise so future calls can retry.
	_initializationPromise = TelemetryService.create()
		.then((service) => {
			_telemetryServiceInstance = service
			_initializationPromise = null
			return service
		})
		.catch((error) => {
			_initializationPromise = null
			throw error
		})

	return _initializationPromise
}

/**
 * Reset the telemetry service instance (useful for testing)
 */
export function resetTelemetryService(): void {
	_telemetryServiceInstance = null
	_initializationPromise = null
}

export const telemetryService = new Proxy({} as TelemetryService, {
	get(_target, prop, _receiver) {
		// Return a function that will call the method on the actual service
		return async (...args: any[]) => {
			const service: TelemetryService = await getTelemetryService()
			const method = Reflect.get(service, prop, service)
			if (typeof method === "function") {
				return method.apply(service, args)
			}
			return method
		}
	},
})

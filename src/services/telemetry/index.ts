export type { ITelemetryProvider, TelemetrySettings } from "./providers/ITelemetryProvider"
export { PostHogTelemetryProvider } from "./providers/PostHogTelemetryProvider"
export { type TelemetryProviderConfig, TelemetryProviderFactory, type TelemetryProviderType } from "./TelemetryProviderFactory"
export { TelemetryService } from "./TelemetryService"

import { TelemetryProviderFactory } from "./TelemetryProviderFactory"

// Create a singleton instance for easy access throughout the application
import { TelemetryService } from "./TelemetryService"

let _telemetryServiceInstance: TelemetryService | null = null

/**
 * Get the singleton telemetry service instance
 * @param distinctId Optional distinct ID for the telemetry provider
 * @returns TelemetryService instance
 */
export function getTelemetryService(): TelemetryService {
	if (!_telemetryServiceInstance) {
		const provider = TelemetryProviderFactory.createProvider({
			type: "posthog",
		})
		_telemetryServiceInstance = new TelemetryService(provider)
	}
	return _telemetryServiceInstance
}

/**
 * Reset the telemetry service instance (useful for testing)
 */
export function resetTelemetryService(): void {
	_telemetryServiceInstance = null
}

export const telemetryService = new Proxy({} as TelemetryService, {
	get(_target, prop, _receiver) {
		const service = getTelemetryService()
		return Reflect.get(service, prop, service)
	},
})

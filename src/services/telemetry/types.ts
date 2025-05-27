import { TelemetryEventName, type TelemetryProperties, type TelemetryEvent } from "@roo-code/types"

export type TelemetryEventSubscription =
	| { type: "include"; events: TelemetryEventName[] }
	| { type: "exclude"; events: TelemetryEventName[] }

export interface TelemetryPropertiesProvider {
	getTelemetryProperties(): Promise<TelemetryProperties>
}

export interface TelemetryClient {
	subscription?: TelemetryEventSubscription

	setProvider(provider: TelemetryPropertiesProvider): void
	capture(options: TelemetryEvent): Promise<void>
	updateTelemetryState(didUserOptIn: boolean): void
	isTelemetryEnabled(): boolean
	shutdown(): Promise<void>
}

import {
	type TelemetryClient,
	type TelemetryEvent,
	type ClineMessage,
	type AuthService,
	type SettingsService,
	TelemetryEventName,
	rooCodeTelemetryEventSchema,
	TelemetryPropertiesProvider,
	TelemetryEventSubscription,
} from "@roo-code/types"

import { getRooCodeApiUrl } from "./config.js"

abstract class BaseTelemetryClient implements TelemetryClient {
	protected providerRef: WeakRef<TelemetryPropertiesProvider> | null = null
	protected telemetryEnabled: boolean = false

	constructor(
		public readonly subscription?: TelemetryEventSubscription,
		protected readonly debug = false,
	) {}

	protected isEventCapturable(eventName: TelemetryEventName): boolean {
		if (!this.subscription) {
			return true
		}

		return this.subscription.type === "include"
			? this.subscription.events.includes(eventName)
			: !this.subscription.events.includes(eventName)
	}

	/**
	 * Determines if a specific property should be included in telemetry events
	 * Override in subclasses to filter specific properties
	 */
	protected isPropertyCapturable(_propertyName: string): boolean {
		return true
	}

	protected async getEventProperties(event: TelemetryEvent): Promise<TelemetryEvent["properties"]> {
		let providerProperties: TelemetryEvent["properties"] = {}
		const provider = this.providerRef?.deref()

		if (provider) {
			try {
				// Get properties from the provider
				providerProperties = await provider.getTelemetryProperties()
			} catch (error) {
				// Log error but continue with capturing the event.
				console.error(
					`Error getting telemetry properties: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}

		// Merge provider properties with event-specific properties.
		// Event properties take precedence in case of conflicts.
		const mergedProperties = {
			...providerProperties,
			...(event.properties || {}),
		}

		// Filter out properties that shouldn't be captured by this client
		return Object.fromEntries(Object.entries(mergedProperties).filter(([key]) => this.isPropertyCapturable(key)))
	}

	public abstract capture(event: TelemetryEvent): Promise<void>

	public setProvider(provider: TelemetryPropertiesProvider): void {
		this.providerRef = new WeakRef(provider)
	}

	public abstract updateTelemetryState(didUserOptIn: boolean): void

	public isTelemetryEnabled(): boolean {
		return this.telemetryEnabled
	}

	public abstract shutdown(): Promise<void>
}

export class CloudTelemetryClient extends BaseTelemetryClient {
	constructor(
		private authService: AuthService,
		private settingsService: SettingsService,
		debug = false,
	) {
		super(
			{
				type: "exclude",
				events: [TelemetryEventName.TASK_CONVERSATION_MESSAGE],
			},
			debug,
		)
	}

	private async fetch(path: string, options: RequestInit) {
		if (!this.authService.isAuthenticated()) {
			return
		}

		const token = this.authService.getSessionToken()

		if (!token) {
			console.error(`[TelemetryClient#fetch] Unauthorized: No session token available.`)
			return
		}

		const response = await fetch(`${getRooCodeApiUrl()}/api/${path}`, {
			...options,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
		})

		if (!response.ok) {
			console.error(
				`[TelemetryClient#fetch] ${options.method} ${path} -> ${response.status} ${response.statusText}`,
			)
		}
	}

	public override async capture(event: TelemetryEvent) {
		if (!this.isTelemetryEnabled() || !this.isEventCapturable(event.event)) {
			if (this.debug) {
				console.info(`[TelemetryClient#capture] Skipping event: ${event.event}`)
			}

			return
		}

		const payload = {
			type: event.event,
			properties: await this.getEventProperties(event),
		}

		if (this.debug) {
			console.info(`[TelemetryClient#capture] ${JSON.stringify(payload)}`)
		}

		const result = rooCodeTelemetryEventSchema.safeParse(payload)

		if (!result.success) {
			console.error(
				`[TelemetryClient#capture] Invalid telemetry event: ${result.error.message} - ${JSON.stringify(payload)}`,
			)

			return
		}

		try {
			await this.fetch(`events`, {
				method: "POST",
				body: JSON.stringify(result.data),
			})
		} catch (error) {
			console.error(`[TelemetryClient#capture] Error sending telemetry event: ${error}`)
		}
	}

	public async backfillMessages(messages: ClineMessage[], taskId: string): Promise<void> {
		if (!this.authService.isAuthenticated()) {
			if (this.debug) {
				console.info(`[TelemetryClient#backfillMessages] Skipping: Not authenticated`)
			}
			return
		}

		const token = this.authService.getSessionToken()

		if (!token) {
			console.error(`[TelemetryClient#backfillMessages] Unauthorized: No session token available.`)
			return
		}

		try {
			const mergedProperties = await this.getEventProperties({
				event: TelemetryEventName.TASK_MESSAGE,
				properties: { taskId },
			})

			const formData = new FormData()
			formData.append("taskId", taskId)
			formData.append("properties", JSON.stringify(mergedProperties))

			formData.append(
				"file",
				new File([JSON.stringify(messages)], "task.json", {
					type: "application/json",
				}),
			)

			if (this.debug) {
				console.info(
					`[TelemetryClient#backfillMessages] Uploading ${messages.length} messages for task ${taskId}`,
				)
			}

			// Custom fetch for multipart - don't set Content-Type header (let browser set it)
			const response = await fetch(`${getRooCodeApiUrl()}/api/events/backfill`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					// Note: No Content-Type header - browser will set multipart/form-data with boundary
				},
				body: formData,
			})

			if (!response.ok) {
				console.error(
					`[TelemetryClient#backfillMessages] POST events/backfill -> ${response.status} ${response.statusText}`,
				)
			} else if (this.debug) {
				console.info(`[TelemetryClient#backfillMessages] Successfully uploaded messages for task ${taskId}`)
			}
		} catch (error) {
			console.error(`[TelemetryClient#backfillMessages] Error uploading messages: ${error}`)
		}
	}

	public override updateTelemetryState(_didUserOptIn: boolean) {}

	public override isTelemetryEnabled(): boolean {
		return true
	}

	protected override isEventCapturable(eventName: TelemetryEventName): boolean {
		// Ensure that this event type is supported by the telemetry client
		if (!super.isEventCapturable(eventName)) {
			return false
		}

		// Only record message telemetry if task sync is enabled
		if (eventName === TelemetryEventName.TASK_MESSAGE) {
			return this.settingsService.isTaskSyncEnabled()
		}

		// Other telemetry types are capturable at this point
		return true
	}

	public override async shutdown() {}
}

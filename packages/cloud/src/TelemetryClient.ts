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
import type { RetryQueue } from "./retry-queue/index.js"

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
	private retryQueue: RetryQueue | null = null

	constructor(
		private authService: AuthService,
		private settingsService: SettingsService,
		retryQueue?: RetryQueue,
	) {
		super({
			type: "exclude",
			events: [TelemetryEventName.TASK_CONVERSATION_MESSAGE],
		})
		this.retryQueue = retryQueue || null
	}

	private async fetch(path: string, options: RequestInit, allowQueueing = true) {
		if (!this.authService.isAuthenticated()) {
			return
		}

		const token = this.authService.getSessionToken()

		if (!token) {
			console.error(`[TelemetryClient#fetch] Unauthorized: No session token available.`)
			return
		}

		const url = `${getRooCodeApiUrl()}/api/${path}`
		const fetchOptions: RequestInit = {
			...options,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
		}

		try {
			const response = await fetch(url, fetchOptions)

			if (!response.ok) {
				console.error(
					`[TelemetryClient#fetch] ${options.method} ${path} -> ${response.status} ${response.statusText}`,
				)

				// Queue for retry on server errors (5xx) or rate limiting (429)
				// Do NOT retry on client errors (4xx) except 429 - they won't succeed
				if (this.retryQueue && allowQueueing && (response.status >= 500 || response.status === 429)) {
					await this.retryQueue.enqueue(url, fetchOptions, "telemetry")
				}
			}

			return response
		} catch (error) {
			console.error(`[TelemetryClient#fetch] Network error for ${options.method} ${path}: ${error}`)

			// Queue for retry on network failures (typically TypeError with "fetch failed" message)
			// These are transient network issues that may succeed on retry
			if (
				this.retryQueue &&
				allowQueueing &&
				error instanceof TypeError &&
				error.message.includes("fetch failed")
			) {
				await this.retryQueue.enqueue(url, fetchOptions, "telemetry")
			}

			throw error
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
			// Error is already queued for retry in the fetch method
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

			const url = `${getRooCodeApiUrl()}/api/events/backfill`
			const fetchOptions: RequestInit = {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
				},
				body: formData,
			}

			try {
				const response = await fetch(url, fetchOptions)

				if (!response.ok) {
					console.error(
						`[TelemetryClient#backfillMessages] POST events/backfill -> ${response.status} ${response.statusText}`,
					)
				}
			} catch (fetchError) {
				console.error(`[TelemetryClient#backfillMessages] Network error: ${fetchError}`)
				throw fetchError
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

import {
	TelemetryEventName,
	type TelemetryEvent,
	rooCodeTelemetryEventSchema,
	type ClineMessage,
} from "@roo-code/types"
import { BaseTelemetryClient } from "@roo-code/telemetry"

import { getRooCodeApiUrl } from "./Config"
import { AuthService } from "./AuthService"
import { SettingsService } from "./SettingsService"

export class TelemetryClient extends BaseTelemetryClient {
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
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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
			await this.fetch(`events`, { method: "POST", body: JSON.stringify(result.data) })
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

		// Only record message telemetry if a cloud account is present and explicitly configured to record messages
		if (eventName === TelemetryEventName.TASK_MESSAGE) {
			return this.settingsService.getSettings()?.cloudSettings?.recordTaskMessages || false
		}

		// Other telemetry types are capturable at this point
		return true
	}

	public override async shutdown() {}
}

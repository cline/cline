import { TelemetryEventName, type TelemetryEvent, rooCodeTelemetryEventSchema } from "@roo-code/types"
import { BaseTelemetryClient } from "@roo-code/telemetry"

import { getRooCodeApiUrl } from "./Config"
import { AuthService } from "./AuthService"

export class TelemetryClient extends BaseTelemetryClient {
	constructor(
		private authService: AuthService,
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

	public override updateTelemetryState(_didUserOptIn: boolean) {}

	public override isTelemetryEnabled(): boolean {
		return true
	}

	public override async shutdown() {}
}

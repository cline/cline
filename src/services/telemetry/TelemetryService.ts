import { PostHog } from "posthog-node"
import * as vscode from "vscode"

class PostHogClient {
	private static instance: PostHogClient
	private client: PostHog
	private distinctId: string = vscode.env.machineId
	private telemetryEnabled: boolean = false

	private constructor() {
		this.client = new PostHog("phc_qfOAGxZw2TL5O8p9KYd9ak3bPBFzfjC8fy5L6jNWY7K", {
			host: "https://us.i.posthog.com",
			enableExceptionAutocapture: false,
		})
	}

	public updateTelemetryState(didUserOptIn: boolean): void {
		this.telemetryEnabled = false

		// First check global telemetry level - telemetry should only be enabled when level is "all"
		const telemetryLevel = vscode.workspace.getConfiguration("telemetry").get<string>("telemetryLevel", "all")
		const globalTelemetryEnabled = telemetryLevel === "all"

		// We only enable telemetry if global vscode telemetry is enabled
		if (globalTelemetryEnabled) {
			this.telemetryEnabled = didUserOptIn
		}

		// Update PostHog client state based on telemetry preference and use machineId to tie it to the webview
		if (this.telemetryEnabled) {
			this.client.optIn()
			this.client.identify({ distinctId: this.distinctId })
			// console.log("Telemetry enabled")
		} else {
			this.client.optOut()
			// console.log("Telemetry disabled")
		}
	}

	public static getInstance(): PostHogClient {
		if (!PostHogClient.instance) {
			PostHogClient.instance = new PostHogClient()
		}
		return PostHogClient.instance
	}

	public capture(event: { event: string; properties?: any }): void {
		// Only send events if telemetry is enabled
		if (this.telemetryEnabled) {
			this.client.capture({ distinctId: this.distinctId, event: event.event, properties: event.properties })
			// console.log("Captured event", { distinctId: this.distinctId, event: event.event, properties: event.properties })
		}
	}

	public isTelemetryEnabled(): boolean {
		return this.telemetryEnabled
	}

	public async shutdown(): Promise<void> {
		await this.client.shutdown()
	}
}

// Export a single instance
export const telemetryService = PostHogClient.getInstance()

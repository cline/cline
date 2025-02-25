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

		// Initialize telemetry state based on user settings
		this.updateTelemetryState()

		// Listen for settings changes
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("cline.enableTelemetry") || e.affectsConfiguration("telemetry.telemetryLevel")) {
				this.updateTelemetryState()
			}
		})
	}

	private updateTelemetryState(): void {
		this.telemetryEnabled = false

		// First check global telemetry level - telemetry should only be enabled when level is "all"
		const telemetryLevel = vscode.workspace.getConfiguration("telemetry").get<string>("telemetryLevel", "all")
		const globalTelemetryEnabled = telemetryLevel === "all"

		// Only check Cline setting if global telemetry is enabled
		if (globalTelemetryEnabled) {
			const clineOptIn = vscode.workspace.getConfiguration("cline").get<boolean | null>("enableTelemetry", null)
			this.telemetryEnabled = clineOptIn === true
		}

		// Update PostHog client state based on telemetry preference
		if (this.telemetryEnabled) {
			this.client.optIn()
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

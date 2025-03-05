import { PostHog } from "posthog-node"
import * as vscode from "vscode"

class PostHogClient {
	// Event constants
	private static readonly EVENTS = {
		TASK: {
			CREATED: "task.created",
			COMPLETED: "task.completed",
			MESSAGE: "task.message",
			TOKEN_USAGE: "task.tokens",
			MODE_SWITCH: "task.mode",
		},
		TOOL: {
			USED: "tool.used",
			AUTO_APPROVED: "tool.auto_approved",
			CHECKPOINT: "tool.checkpoint",
		},
		UI: {
			PROVIDER_SWITCH: "ui.provider",
			IMAGE_ATTACH: "ui.image",
			BUTTON_CLICK: "ui.button",
		},
	}

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

	// Task events
	public captureTaskCreated(taskId: string) {
		this.capture({
			event: PostHogClient.EVENTS.TASK.CREATED,
			properties: { taskId },
		})
	}

	public captureTaskCompleted(taskId: string, action: "accept" | "reject") {
		this.capture({
			event: PostHogClient.EVENTS.TASK.COMPLETED,
			properties: { taskId, action },
		})
	}

	public captureMessage(taskId: string, provider: string, model: string) {
		this.capture({
			event: PostHogClient.EVENTS.TASK.MESSAGE,
			properties: { taskId, provider, model },
		})
	}

	public captureTokenUsage(taskId: string, tokensIn: number, tokensOut: number) {
		this.capture({
			event: PostHogClient.EVENTS.TASK.TOKEN_USAGE,
			properties: { taskId, tokensIn, tokensOut },
		})
	}

	public captureModeSwitch(taskId: string, mode: "plan" | "act") {
		this.capture({
			event: PostHogClient.EVENTS.TASK.MODE_SWITCH,
			properties: { taskId, mode },
		})
	}

	// Tool events
	public captureToolUsage(taskId: string, tool: string) {
		this.capture({
			event: PostHogClient.EVENTS.TOOL.USED,
			properties: { taskId, tool },
		})
	}

	public captureToolAutoApproval(taskId: string, tool: string) {
		this.capture({
			event: PostHogClient.EVENTS.TOOL.AUTO_APPROVED,
			properties: { taskId, tool },
		})
	}

	public captureCheckpointUsage(taskId: string) {
		this.capture({
			event: PostHogClient.EVENTS.TOOL.CHECKPOINT,
			properties: { taskId },
		})
	}

	// UI events
	public captureProviderSwitch(from: string, to: string, location: "settings" | "bottom") {
		this.capture({
			event: PostHogClient.EVENTS.UI.PROVIDER_SWITCH,
			properties: { from, to, location },
		})
	}

	public captureImageAttached(taskId: string) {
		this.capture({
			event: PostHogClient.EVENTS.UI.IMAGE_ATTACH,
			properties: { taskId },
		})
	}

	public captureButtonClick(button: string) {
		this.capture({
			event: PostHogClient.EVENTS.UI.BUTTON_CLICK,
			properties: { button },
		})
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

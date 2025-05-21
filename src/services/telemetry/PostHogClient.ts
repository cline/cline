import { PostHog } from "posthog-node"
import * as vscode from "vscode"

import { logger } from "../../utils/logging"

// This forward declaration is needed to avoid circular dependencies
export interface ClineProviderInterface {
	// Gets telemetry properties to attach to every event
	getTelemetryProperties(): Promise<Record<string, any>>
}

/**
 * PostHogClient handles telemetry event tracking for the Roo Code extension
 * Uses PostHog analytics to track user interactions and system events
 * Respects user privacy settings and VSCode's global telemetry configuration
 */
export class PostHogClient {
	public static readonly EVENTS = {
		TASK: {
			CREATED: "Task Created",
			RESTARTED: "Task Reopened",
			COMPLETED: "Task Completed",
			CONVERSATION_MESSAGE: "Conversation Message",
			MODE_SWITCH: "Mode Switched",
			TOOL_USED: "Tool Used",
			CHECKPOINT_CREATED: "Checkpoint Created",
			CHECKPOINT_RESTORED: "Checkpoint Restored",
			CHECKPOINT_DIFFED: "Checkpoint Diffed",
			CODE_ACTION_USED: "Code Action Used",
			PROMPT_ENHANCED: "Prompt Enhanced",
			CONTEXT_CONDENSED: "Context Condensed",
			SLIDING_WINDOW_TRUNCATION: "Sliding Window Truncation",
		},
		ERRORS: {
			SCHEMA_VALIDATION_ERROR: "Schema Validation Error",
			DIFF_APPLICATION_ERROR: "Diff Application Error",
			SHELL_INTEGRATION_ERROR: "Shell Integration Error",
			CONSECUTIVE_MISTAKE_ERROR: "Consecutive Mistake Error",
		},
	}

	private static instance: PostHogClient
	private client: PostHog
	private distinctId: string = vscode.env.machineId
	private telemetryEnabled: boolean = false
	private providerRef: WeakRef<ClineProviderInterface> | null = null

	private constructor() {
		this.client = new PostHog(process.env.POSTHOG_API_KEY || "", { host: "https://us.i.posthog.com" })
	}

	/**
	 * Updates the telemetry state based on user preferences and VSCode settings
	 * Only enables telemetry if both VSCode global telemetry is enabled and user has opted in
	 * @param didUserOptIn Whether the user has explicitly opted into telemetry
	 */
	public updateTelemetryState(didUserOptIn: boolean): void {
		this.telemetryEnabled = false

		// First check global telemetry level - telemetry should only be enabled when level is "all"
		const telemetryLevel = vscode.workspace.getConfiguration("telemetry").get<string>("telemetryLevel", "all")
		const globalTelemetryEnabled = telemetryLevel === "all"

		// We only enable telemetry if global vscode telemetry is enabled
		if (globalTelemetryEnabled) {
			this.telemetryEnabled = didUserOptIn
		}

		// Update PostHog client state based on telemetry preference
		if (this.telemetryEnabled) {
			this.client.optIn()
		} else {
			this.client.optOut()
		}
	}

	/**
	 * Gets or creates the singleton instance of PostHogClient
	 * @returns The PostHogClient instance
	 */
	public static getInstance(): PostHogClient {
		if (!PostHogClient.instance) {
			PostHogClient.instance = new PostHogClient()
		}

		return PostHogClient.instance
	}

	/**
	 * Sets the ClineProvider reference to use for global properties
	 * @param provider A ClineProvider instance to use
	 */
	public setProvider(provider: ClineProviderInterface): void {
		this.providerRef = new WeakRef(provider)
		logger.debug("PostHogClient: ClineProvider reference set")
	}

	/**
	 * Captures a telemetry event if telemetry is enabled
	 * @param event The event to capture with its properties
	 */
	public async capture(event: { event: string; properties?: any }): Promise<void> {
		// Only send events if telemetry is enabled
		if (this.telemetryEnabled) {
			// Get global properties from ClineProvider if available
			let globalProperties: Record<string, any> = {}
			const provider = this.providerRef?.deref()

			if (provider) {
				try {
					// Get the telemetry properties directly from the provider
					globalProperties = await provider.getTelemetryProperties()
				} catch (error) {
					// Log error but continue with capturing the event
					logger.error(
						`Error getting telemetry properties: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}

			// Merge global properties with event-specific properties
			// Event properties take precedence in case of conflicts
			const mergedProperties = {
				...globalProperties,
				...(event.properties || {}),
			}

			this.client.capture({
				distinctId: this.distinctId,
				event: event.event,
				properties: mergedProperties,
			})
		}
	}

	/**
	 * Checks if telemetry is currently enabled
	 * @returns Whether telemetry is enabled
	 */
	public isTelemetryEnabled(): boolean {
		return this.telemetryEnabled
	}

	/**
	 * Shuts down the PostHog client
	 */
	public async shutdown(): Promise<void> {
		await this.client.shutdown()
	}
}

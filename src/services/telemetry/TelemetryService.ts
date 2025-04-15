import { PostHog } from "posthog-node"
import * as vscode from "vscode"
import { ZodError } from "zod"

import { logger } from "../../utils/logging"

// This forward declaration is needed to avoid circular dependencies
interface ClineProviderInterface {
	// Gets telemetry properties to attach to every event
	getTelemetryProperties(): Promise<Record<string, any>>
}

/**
 * PostHogClient handles telemetry event tracking for the Roo Code extension
 * Uses PostHog analytics to track user interactions and system events
 * Respects user privacy settings and VSCode's global telemetry configuration
 */
class PostHogClient {
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
		},
		ERRORS: {
			SCHEMA_VALIDATION_ERROR: "Schema Validation Error",
			DIFF_APPLICATION_ERROR: "Diff Application Error",
		},
	}

	private static instance: PostHogClient
	private client: PostHog
	private distinctId: string = vscode.env.machineId
	private telemetryEnabled: boolean = false
	private providerRef: WeakRef<ClineProviderInterface> | null = null

	private constructor() {
		this.client = new PostHog(process.env.POSTHOG_API_KEY || "", {
			host: "https://us.i.posthog.com",
		})
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

/**
 * TelemetryService wrapper class that defers PostHogClient initialization
 * This ensures that we only create the PostHogClient after environment variables are loaded
 */
class TelemetryService {
	private client: PostHogClient | null = null
	private initialized = false
	private providerRef: WeakRef<ClineProviderInterface> | null = null

	/**
	 * Initialize the telemetry service with the PostHog client
	 * This should be called after environment variables are loaded
	 */
	public initialize(): void {
		if (this.initialized) {
			return
		}

		try {
			this.client = PostHogClient.getInstance()
			this.initialized = true
		} catch (error) {
			console.warn("Failed to initialize telemetry service:", error)
		}
	}

	/**
	 * Sets the ClineProvider reference to use for global properties
	 * @param provider A ClineProvider instance to use
	 */
	public setProvider(provider: ClineProviderInterface): void {
		// Keep a weak reference to avoid memory leaks
		this.providerRef = new WeakRef(provider)
		// If client is initialized, pass the provider reference
		if (this.isReady()) {
			this.client!.setProvider(provider)
		}
		logger.debug("TelemetryService: ClineProvider reference set")
	}

	/**
	 * Base method for all telemetry operations
	 * Checks if the service is initialized before performing any operation
	 * @returns Whether the service is ready to use
	 */
	private isReady(): boolean {
		return this.initialized && this.client !== null
	}

	/**
	 * Updates the telemetry state based on user preferences and VSCode settings
	 * @param didUserOptIn Whether the user has explicitly opted into telemetry
	 */
	public updateTelemetryState(didUserOptIn: boolean): void {
		if (!this.isReady()) return
		this.client!.updateTelemetryState(didUserOptIn)
	}

	/**
	 * Captures a telemetry event if telemetry is enabled
	 * @param event The event to capture with its properties
	 */
	public capture(event: { event: string; properties?: any }): void {
		if (!this.isReady()) return
		this.client!.capture(event)
	}

	/**
	 * Generic method to capture any type of event with specified properties
	 * @param eventName The event name to capture
	 * @param properties The event properties
	 */
	public captureEvent(eventName: string, properties?: any): void {
		this.capture({ event: eventName, properties })
	}

	// Task events convenience methods
	public captureTaskCreated(taskId: string): void {
		this.captureEvent(PostHogClient.EVENTS.TASK.CREATED, { taskId })
	}

	public captureTaskRestarted(taskId: string): void {
		this.captureEvent(PostHogClient.EVENTS.TASK.RESTARTED, { taskId })
	}

	public captureTaskCompleted(taskId: string): void {
		this.captureEvent(PostHogClient.EVENTS.TASK.COMPLETED, { taskId })
	}

	public captureConversationMessage(taskId: string, source: "user" | "assistant"): void {
		this.captureEvent(PostHogClient.EVENTS.TASK.CONVERSATION_MESSAGE, {
			taskId,
			source,
		})
	}

	public captureModeSwitch(taskId: string, newMode: string): void {
		this.captureEvent(PostHogClient.EVENTS.TASK.MODE_SWITCH, {
			taskId,
			newMode,
		})
	}

	public captureToolUsage(taskId: string, tool: string): void {
		this.captureEvent(PostHogClient.EVENTS.TASK.TOOL_USED, {
			taskId,
			tool,
		})
	}

	public captureCheckpointCreated(taskId: string): void {
		this.captureEvent(PostHogClient.EVENTS.TASK.CHECKPOINT_CREATED, { taskId })
	}

	public captureCheckpointDiffed(taskId: string): void {
		this.captureEvent(PostHogClient.EVENTS.TASK.CHECKPOINT_DIFFED, { taskId })
	}

	public captureCheckpointRestored(taskId: string): void {
		this.captureEvent(PostHogClient.EVENTS.TASK.CHECKPOINT_RESTORED, { taskId })
	}

	public captureSchemaValidationError({ schemaName, error }: { schemaName: string; error: ZodError }): void {
		this.captureEvent(PostHogClient.EVENTS.ERRORS.SCHEMA_VALIDATION_ERROR, {
			schemaName,
			// https://zod.dev/ERROR_HANDLING?id=formatting-errors
			error: error.format(),
		})
	}

	public captureDiffApplicationError(taskId: string): void {
		this.captureEvent(PostHogClient.EVENTS.ERRORS.DIFF_APPLICATION_ERROR, {
			taskId,
		})
	}

	/**
	 * Checks if telemetry is currently enabled
	 * @returns Whether telemetry is enabled
	 */
	public isTelemetryEnabled(): boolean {
		if (!this.isReady()) return false
		return this.client!.isTelemetryEnabled()
	}

	/**
	 * Shuts down the PostHog client
	 */
	public async shutdown(): Promise<void> {
		if (!this.isReady()) return
		await this.client!.shutdown()
	}
}

// Export a singleton instance of the telemetry service wrapper
export const telemetryService = new TelemetryService()

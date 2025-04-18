import { ZodError } from "zod"

import { logger } from "../../utils/logging"
import { PostHogClient, ClineProviderInterface } from "./PostHogClient"

/**
 * TelemetryService wrapper class that defers PostHogClient initialization
 * This ensures that we only create the PostHogClient after environment variables are loaded
 */
class TelemetryService {
	private client: PostHogClient | null = null
	private initialized = false

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
		// If client is initialized, pass the provider reference
		if (this.isReady) {
			this.client!.setProvider(provider)
		}

		logger.debug("TelemetryService: ClineProvider reference set")
	}

	/**
	 * Base method for all telemetry operations
	 * Checks if the service is initialized before performing any operation
	 * @returns Whether the service is ready to use
	 */
	private get isReady(): boolean {
		return this.initialized && this.client !== null
	}

	/**
	 * Updates the telemetry state based on user preferences and VSCode settings
	 * @param didUserOptIn Whether the user has explicitly opted into telemetry
	 */
	public updateTelemetryState(didUserOptIn: boolean): void {
		if (!this.isReady) {
			return
		}

		this.client!.updateTelemetryState(didUserOptIn)
	}

	/**
	 * Captures a telemetry event if telemetry is enabled
	 * @param event The event to capture with its properties
	 */
	public capture(event: { event: string; properties?: any }): void {
		if (!this.isReady) {
			return
		}

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
		this.captureEvent(PostHogClient.EVENTS.TASK.CONVERSATION_MESSAGE, { taskId, source })
	}

	public captureModeSwitch(taskId: string, newMode: string): void {
		this.captureEvent(PostHogClient.EVENTS.TASK.MODE_SWITCH, { taskId, newMode })
	}

	public captureToolUsage(taskId: string, tool: string): void {
		this.captureEvent(PostHogClient.EVENTS.TASK.TOOL_USED, { taskId, tool })
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

	public captureCodeActionUsed(actionType: string): void {
		this.captureEvent(PostHogClient.EVENTS.TASK.CODE_ACTION_USED, { actionType })
	}

	public capturePromptEnhanced(taskId?: string): void {
		this.captureEvent(PostHogClient.EVENTS.TASK.PROMPT_ENHANCED, { ...(taskId && { taskId }) })
	}

	public captureSchemaValidationError({ schemaName, error }: { schemaName: string; error: ZodError }): void {
		// https://zod.dev/ERROR_HANDLING?id=formatting-errors
		this.captureEvent(PostHogClient.EVENTS.ERRORS.SCHEMA_VALIDATION_ERROR, { schemaName, error: error.format() })
	}

	public captureDiffApplicationError(taskId: string, consecutiveMistakeCount: number): void {
		this.captureEvent(PostHogClient.EVENTS.ERRORS.DIFF_APPLICATION_ERROR, { taskId, consecutiveMistakeCount })
	}

	public captureShellIntegrationError(taskId: string): void {
		this.captureEvent(PostHogClient.EVENTS.ERRORS.SHELL_INTEGRATION_ERROR, { taskId })
	}

	public captureConsecutiveMistakeError(taskId: string): void {
		this.captureEvent(PostHogClient.EVENTS.ERRORS.CONSECUTIVE_MISTAKE_ERROR, { taskId })
	}

	/**
	 * Checks if telemetry is currently enabled
	 * @returns Whether telemetry is enabled
	 */
	public isTelemetryEnabled(): boolean {
		return this.isReady && this.client!.isTelemetryEnabled()
	}

	/**
	 * Shuts down the PostHog client
	 */
	public async shutdown(): Promise<void> {
		if (!this.isReady) {
			return
		}

		await this.client!.shutdown()
	}
}

// Export a singleton instance of the telemetry service wrapper
export const telemetryService = new TelemetryService()

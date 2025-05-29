import { ZodError } from "zod"

import { type TelemetryClient, type TelemetryPropertiesProvider, TelemetryEventName } from "@roo-code/types"

/**
 * TelemetryService wrapper class that defers initialization.
 * This ensures that we only create the various clients after environment
 * variables are loaded.
 */
export class TelemetryService {
	constructor(private clients: TelemetryClient[]) {}

	public register(client: TelemetryClient): void {
		this.clients.push(client)
	}

	/**
	 * Sets the ClineProvider reference to use for global properties
	 * @param provider A ClineProvider instance to use
	 */
	public setProvider(provider: TelemetryPropertiesProvider): void {
		// If client is initialized, pass the provider reference.
		if (this.isReady) {
			this.clients.forEach((client) => client.setProvider(provider))
		}
	}

	/**
	 * Base method for all telemetry operations
	 * Checks if the service is initialized before performing any operation
	 * @returns Whether the service is ready to use
	 */
	private get isReady(): boolean {
		return this.clients.length > 0
	}

	/**
	 * Updates the telemetry state based on user preferences and VSCode settings
	 * @param didUserOptIn Whether the user has explicitly opted into telemetry
	 */
	public updateTelemetryState(didUserOptIn: boolean): void {
		if (!this.isReady) {
			return
		}

		this.clients.forEach((client) => client.updateTelemetryState(didUserOptIn))
	}

	/**
	 * Generic method to capture any type of event with specified properties
	 * @param eventName The event name to capture
	 * @param properties The event properties
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public captureEvent(eventName: TelemetryEventName, properties?: Record<string, any>): void {
		if (!this.isReady) {
			return
		}

		this.clients.forEach((client) => client.capture({ event: eventName, properties }))
	}

	public captureTaskCreated(taskId: string): void {
		this.captureEvent(TelemetryEventName.TASK_CREATED, { taskId })
	}

	public captureTaskRestarted(taskId: string): void {
		this.captureEvent(TelemetryEventName.TASK_RESTARTED, { taskId })
	}

	public captureTaskCompleted(taskId: string): void {
		this.captureEvent(TelemetryEventName.TASK_COMPLETED, { taskId })
	}

	public captureConversationMessage(taskId: string, source: "user" | "assistant"): void {
		this.captureEvent(TelemetryEventName.TASK_CONVERSATION_MESSAGE, { taskId, source })
	}

	public captureLlmCompletion(
		taskId: string,
		properties: {
			inputTokens: number
			outputTokens: number
			cacheWriteTokens: number
			cacheReadTokens: number
			cost?: number
		},
	): void {
		this.captureEvent(TelemetryEventName.LLM_COMPLETION, { taskId, ...properties })
	}

	public captureModeSwitch(taskId: string, newMode: string): void {
		this.captureEvent(TelemetryEventName.MODE_SWITCH, { taskId, newMode })
	}

	public captureToolUsage(taskId: string, tool: string): void {
		this.captureEvent(TelemetryEventName.TOOL_USED, { taskId, tool })
	}

	public captureCheckpointCreated(taskId: string): void {
		this.captureEvent(TelemetryEventName.CHECKPOINT_CREATED, { taskId })
	}

	public captureCheckpointDiffed(taskId: string): void {
		this.captureEvent(TelemetryEventName.CHECKPOINT_DIFFED, { taskId })
	}

	public captureCheckpointRestored(taskId: string): void {
		this.captureEvent(TelemetryEventName.CHECKPOINT_RESTORED, { taskId })
	}

	public captureContextCondensed(
		taskId: string,
		isAutomaticTrigger: boolean,
		usedCustomPrompt?: boolean,
		usedCustomApiHandler?: boolean,
	): void {
		this.captureEvent(TelemetryEventName.CONTEXT_CONDENSED, {
			taskId,
			isAutomaticTrigger,
			...(usedCustomPrompt !== undefined && { usedCustomPrompt }),
			...(usedCustomApiHandler !== undefined && { usedCustomApiHandler }),
		})
	}

	public captureSlidingWindowTruncation(taskId: string): void {
		this.captureEvent(TelemetryEventName.SLIDING_WINDOW_TRUNCATION, { taskId })
	}

	public captureCodeActionUsed(actionType: string): void {
		this.captureEvent(TelemetryEventName.CODE_ACTION_USED, { actionType })
	}

	public capturePromptEnhanced(taskId?: string): void {
		this.captureEvent(TelemetryEventName.PROMPT_ENHANCED, { ...(taskId && { taskId }) })
	}

	public captureSchemaValidationError({ schemaName, error }: { schemaName: string; error: ZodError }): void {
		// https://zod.dev/ERROR_HANDLING?id=formatting-errors
		this.captureEvent(TelemetryEventName.SCHEMA_VALIDATION_ERROR, { schemaName, error: error.format() })
	}

	public captureDiffApplicationError(taskId: string, consecutiveMistakeCount: number): void {
		this.captureEvent(TelemetryEventName.DIFF_APPLICATION_ERROR, { taskId, consecutiveMistakeCount })
	}

	public captureShellIntegrationError(taskId: string): void {
		this.captureEvent(TelemetryEventName.SHELL_INTEGRATION_ERROR, { taskId })
	}

	public captureConsecutiveMistakeError(taskId: string): void {
		this.captureEvent(TelemetryEventName.CONSECUTIVE_MISTAKE_ERROR, { taskId })
	}

	/**
	 * Captures a title button click event
	 * @param button The button that was clicked
	 */
	public captureTitleButtonClicked(button: string): void {
		this.captureEvent(TelemetryEventName.TITLE_BUTTON_CLICKED, { button })
	}

	/**
	 * Checks if telemetry is currently enabled
	 * @returns Whether telemetry is enabled
	 */
	public isTelemetryEnabled(): boolean {
		return this.isReady && this.clients.some((client) => client.isTelemetryEnabled())
	}

	public async shutdown(): Promise<void> {
		if (!this.isReady) {
			return
		}

		this.clients.forEach((client) => client.shutdown())
	}

	private static _instance: TelemetryService | null = null

	static createInstance(clients: TelemetryClient[] = []) {
		if (this._instance) {
			throw new Error("TelemetryService instance already created")
		}

		this._instance = new TelemetryService(clients)
		return this._instance
	}

	static get instance() {
		if (!this._instance) {
			throw new Error("TelemetryService not initialized")
		}

		return this._instance
	}

	static hasInstance(): boolean {
		return this._instance !== null
	}
}

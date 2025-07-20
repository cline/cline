import { PostHog } from "posthog-node"
import * as vscode from "vscode"
import { version as extensionVersion } from "../../../../package.json"

import type { TaskFeedbackType } from "@shared/WebviewMessage"
import type { BrowserSettings } from "@shared/BrowserSettings"
import { posthogClientProvider } from "../PostHogClientProvider"
import { Mode } from "@/shared/ChatSettings"

/**
 * TelemetryService handles telemetry event tracking for the Cline extension
 * Uses PostHog analytics to track user interactions and system events
 * Respects user privacy settings and VSCode's global telemetry configuration
 */

/**
 * Represents telemetry event categories that can be individually enabled or disabled
 * When adding a new category, add it both here and to the initial values in telemetryCategoryEnabled
 * Ensure `if (!this.isCategoryEnabled('<category_name>')` is added to the capture method
 */
type TelemetryCategory = "checkpoints" | "browser"

/**
 * Maximum length for error messages to prevent excessive data
 */
const MAX_ERROR_MESSAGE_LENGTH = 500

class TelemetryService {
	// Map to control specific telemetry categories (event types)
	private telemetryCategoryEnabled: Map<TelemetryCategory, boolean> = new Map([
		["checkpoints", false], // Checkpoints telemetry disabled
		["browser", true], // Browser telemetry enabled
	])

	// Event constants for tracking user interactions and system events
	private static readonly EVENTS = {
		// Task-related events for tracking conversation and execution flow

		USER: {
			OPT_OUT: "user.opt_out",
			EXTENSION_ACTIVATED: "user.extension_activated",
		},
		TASK: {
			// Tracks when a new task/conversation is started
			CREATED: "task.created",
			// Tracks when a task is reopened
			RESTARTED: "task.restarted",
			// Tracks when a task is finished, with acceptance or rejection status
			COMPLETED: "task.completed",
			// Tracks user feedback on completed tasks
			FEEDBACK: "task.feedback",
			// Tracks when a message is sent in a conversation
			CONVERSATION_TURN: "task.conversation_turn",
			// Tracks token consumption for cost and usage analysis
			TOKEN_USAGE: "task.tokens",
			// Tracks switches between plan and act modes
			MODE_SWITCH: "task.mode",
			// Tracks when users select an option from AI-generated followup questions
			OPTION_SELECTED: "task.option_selected",
			// Tracks when users type a custom response instead of selecting an option from AI-generated followup questions
			OPTIONS_IGNORED: "task.options_ignored",
			// Tracks usage of the git-based checkpoint system (shadow_git_initialized, commit_created, branch_created, branch_deleted_active, branch_deleted_inactive, restored)
			CHECKPOINT_USED: "task.checkpoint_used",
			// Tracks when tools (like file operations, commands) are used
			TOOL_USED: "task.tool_used",
			// Tracks when a historical task is loaded from storage
			HISTORICAL_LOADED: "task.historical_loaded",
			// Tracks when the retry button is clicked for failed operations
			RETRY_CLICKED: "task.retry_clicked",
			// Tracks when a diff edit (replace_in_file) operation fails
			DIFF_EDIT_FAILED: "task.diff_edit_failed",
			// Tracks when the browser tool is started
			BROWSER_TOOL_START: "task.browser_tool_start",
			// Tracks when the browser tool is completed
			BROWSER_TOOL_END: "task.browser_tool_end",
			// Tracks when browser errors occur
			BROWSER_ERROR: "task.browser_error",
			// Tracks Gemini API specific performance metrics
			GEMINI_API_PERFORMANCE: "task.gemini_api_performance",
			// Tracks when API providers return errors
			PROVIDER_API_ERROR: "task.provider_api_error",
		},
		// UI interaction events for tracking user engagement
		UI: {
			// Tracks when a different model is selected
			MODEL_SELECTED: "ui.model_selected",
			// Tracks when users use the "favorite" button in the model picker
			MODEL_FAVORITE_TOGGLED: "ui.model_favorite_toggled",
			// Tracks when a button is clicked
			BUTTON_CLICKED: "ui.button_clicked",
		},
	}

	/** Singleton instance of the TelemetryService */
	private static instance: TelemetryService
	/** PostHog client instance for sending analytics events */
	private client: PostHog
	/** Unique identifier for the current VSCode instance */
	public distinctId: string = vscode.env.machineId
	/** Whether telemetry is currently enabled based on user and VSCode settings */
	private telemetryEnabled: boolean = false
	/** Current version of the extension */
	private readonly version: string = extensionVersion
	/** Whether the extension is running in development mode */
	private readonly isDev = process.env.IS_DEV

	/**
	 * Private constructor to enforce singleton pattern
	 * Initializes PostHog client with configuration
	 */
	private constructor() {
		this.client = posthogClientProvider.getClient()
	}

	private setDistinctId(installId: string) {
		if (this.distinctId === "someValue.machineId") {
			this.distinctId = installId
		}
	}

	/**
	 * Updates the telemetry state based on user preferences and VSCode settings
	 * Only enables telemetry if both VSCode global telemetry is enabled and user has opted in
	 * @param didUserOptIn Whether the user has explicitly opted into telemetry
	 */
	public async updateTelemetryState(didUserOptIn: boolean): Promise<void> {
		// First check global telemetry level - telemetry should only be enabled when level is "all"
		const telemetryLevel = vscode.workspace.getConfiguration("telemetry").get<string>("telemetryLevel", "all")
		const globalTelemetryEnabled = telemetryLevel === "all"

		// We only enable telemetry if global vscode telemetry is enabled
		if (globalTelemetryEnabled) {
			this.telemetryEnabled = didUserOptIn
		} else {
			// Only show warning if user has opted in to Cline telemetry but VS Code telemetry is disabled
			if (didUserOptIn) {
				void vscode.window
					.showWarningMessage(
						"Anonymous Cline error and usage reporting is enabled, but VSCode telemetry is disabled. To enable error and usage reporting for this extension, enable VSCode telemetry in settings.",
						"Open Settings",
					)
					.then((selection) => {
						if (selection === "Open Settings") {
							void vscode.commands.executeCommand("workbench.action.openSettings", "telemetry.telemetryLevel")
						}
					})
			}
			this.telemetryEnabled = false
		}

		// Update PostHog client state based on telemetry preference
		if (this.telemetryEnabled) {
			this.client.optIn()
			this.client.identify({ distinctId: this.distinctId })
		} else {
			this.client.capture({
				distinctId: this.distinctId,
				event: TelemetryService.EVENTS.USER.OPT_OUT,
				properties: this.addProperties({}),
			})

			await new Promise((resolve) => setTimeout(resolve, 1000)) // Delay 1 second before opting out
			this.client.optOut()
		}
	}

	/**
	 * Gets or creates the singleton instance of TelemetryService
	 * @returns The TelemetryService instance
	 */
	public static getInstance(): TelemetryService {
		if (!TelemetryService.instance) {
			TelemetryService.instance = new TelemetryService()
		}
		return TelemetryService.instance
	}

	private addProperties(properties: any): any {
		return {
			...properties,
			extension_version: this.version,
			is_dev: this.isDev,
		}
	}

	/**
	 * Captures a telemetry event if telemetry is enabled
	 * @param event The event to capture with its properties
	 */
	public capture(event: { event: string; properties?: any }): void {
		if (!this.telemetryEnabled) {
			return
		}

		const propertiesWithVersion = this.addProperties(event.properties)

		const capturedEvent = {
			event: event.event,
			properties: propertiesWithVersion,
		}

		this.client.capture({ ...capturedEvent, distinctId: this.distinctId })
	}

	public captureExtensionActivated(installId: string) {
		this.setDistinctId(installId)

		if (this.telemetryEnabled) {
			this.client.identify({ distinctId: this.distinctId })
			this.client.capture({ distinctId: this.distinctId, event: TelemetryService.EVENTS.USER.EXTENSION_ACTIVATED })
		}
	}

	// Task events
	/**
	 * Records when a new task/conversation is started
	 * @param taskId Unique identifier for the new task
	 * @param apiProvider Optional API provider
	 */
	public captureTaskCreated(taskId: string, apiProvider?: string) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.CREATED,
			properties: { taskId, apiProvider },
		})
	}

	/**
	 * Records when a task/conversation is restarted
	 * @param taskId Unique identifier for the new task
	 * @param apiProvider Optional API provider
	 */
	public captureTaskRestarted(taskId: string, apiProvider?: string) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.RESTARTED,
			properties: { taskId, apiProvider },
		})
	}

	/**
	 * Records when cline calls the task completion_result tool signifying that cline is done with the task
	 * @param taskId Unique identifier for the task
	 */
	public captureTaskCompleted(taskId: string) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.COMPLETED,
			properties: { taskId },
		})
	}

	/**
	 * Captures that a message was sent, and includes the API provider and model used
	 * @param taskId Unique identifier for the task
	 * @param provider The API provider (e.g., OpenAI, Anthropic)
	 * @param model The specific model used (e.g., GPT-4, Claude)
	 * @param source The source of the message ("user" | "model"). Used to track message patterns and identify when users need to correct the model's responses.
	 * @param tokenUsage Optional token usage data
	 */
	public captureConversationTurnEvent(
		taskId: string,
		provider: string = "unknown",
		model: string = "unknown",
		source: "user" | "assistant",
		tokenUsage: {
			tokensIn?: number
			tokensOut?: number
			cacheWriteTokens?: number
			cacheReadTokens?: number
			totalCost?: number
		} = {},
	) {
		// Ensure required parameters are provided
		if (!taskId || !provider || !model || !source) {
			console.warn("TelemetryService: Missing required parameters for message capture")
			return
		}

		const properties: Record<string, any> = {
			taskId,
			provider,
			model,
			source,
			timestamp: new Date().toISOString(), // Add timestamp for message sequencing
			...tokenUsage,
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.CONVERSATION_TURN,
			properties,
		})
	}

	/**
	 * Records token usage metrics for cost tracking and usage analysis
	 * @param taskId Unique identifier for the task
	 * @param tokensIn Number of input tokens consumed
	 * @param tokensOut Number of output tokens generated
	 * @param model The model used for token calculation
	 */
	public captureTokenUsage(taskId: string, tokensIn: number, tokensOut: number, model: string) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.TOKEN_USAGE,
			properties: {
				taskId,
				tokensIn,
				tokensOut,
				model,
			},
		})
	}

	/**
	 * Records when a task switches between plan and act modes
	 * @param taskId Unique identifier for the task
	 * @param mode The mode being switched to (plan or act)
	 */
	public captureModeSwitch(taskId: string, mode: Mode) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.MODE_SWITCH,
			properties: {
				taskId,
				mode,
			},
		})
	}

	/**
	 * Records user feedback on completed tasks
	 * @param taskId Unique identifier for the task
	 * @param feedbackType The type of feedback ("thumbs_up" or "thumbs_down")
	 */
	public captureTaskFeedback(taskId: string, feedbackType: TaskFeedbackType) {
		console.info("TelemetryService: Capturing task feedback", { taskId, feedbackType })
		this.capture({
			event: TelemetryService.EVENTS.TASK.FEEDBACK,
			properties: {
				taskId,
				feedbackType,
			},
		})
	}

	// Tool events
	/**
	 * Records when a tool is used during task execution
	 * @param taskId Unique identifier for the task
	 * @param tool Name of the tool being used
	 * @param autoApproved Whether the tool was auto-approved based on settings
	 * @param success Whether the tool execution was successful
	 */
	public captureToolUsage(taskId: string, tool: string, modelId: string, autoApproved: boolean, success: boolean) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.TOOL_USED,
			properties: {
				taskId,
				tool,
				autoApproved,
				success,
				modelId,
			},
		})
	}

	/**
	 * Records interactions with the git-based checkpoint system
	 * @param taskId Unique identifier for the task
	 * @param action The type of checkpoint action
	 * @param durationMs Optional duration of the operation in milliseconds
	 */
	public captureCheckpointUsage(
		taskId: string,
		action: "shadow_git_initialized" | "commit_created" | "restored" | "diff_generated",
		durationMs?: number,
	) {
		if (!this.isCategoryEnabled("checkpoints")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.CHECKPOINT_USED,
			properties: {
				taskId,
				action,
				durationMs,
			},
		})
	}

	/**
	 * Records when a diff edit (replace_in_file) operation fails
	 * @param taskId Unique identifier for the task
	 * @param errorType Type of error that occurred (e.g., "search_not_found", "invalid_format")
	 */
	public captureDiffEditFailure(taskId: string, modelId: string, errorType?: string) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.DIFF_EDIT_FAILED,
			properties: {
				taskId,
				errorType,
				modelId,
			},
		})
	}

	/**
	 * Records when a different model is selected for use
	 * @param model Name of the selected model
	 * @param provider Provider of the selected model
	 * @param taskId Optional task identifier if model was selected during a task
	 */
	public captureModelSelected(model: string, provider: string, taskId?: string) {
		this.capture({
			event: TelemetryService.EVENTS.UI.MODEL_SELECTED,
			properties: {
				model,
				provider,
				taskId,
			},
		})
	}

	/**
	 * Records when a historical task is loaded from storage
	 * @param taskId Unique identifier for the historical task
	 */
	public captureHistoricalTaskLoaded(taskId: string) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.HISTORICAL_LOADED,
			properties: {
				taskId,
			},
		})
	}

	/**
	 * Records when the retry button is clicked for failed operations
	 * @param taskId Unique identifier for the task being retried
	 */
	public captureRetryClicked(taskId: string) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.RETRY_CLICKED,
			properties: {
				taskId,
			},
		})
	}

	/**
	 * Records when the browser tool is started
	 * @param taskId Unique identifier for the task
	 * @param browserSettings The browser settings being used
	 */
	public captureBrowserToolStart(taskId: string, browserSettings: BrowserSettings) {
		if (!this.isCategoryEnabled("browser")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.BROWSER_TOOL_START,
			properties: {
				taskId,
				viewport: browserSettings.viewport,
				isRemote: !!browserSettings.remoteBrowserEnabled,
				remoteBrowserHost: browserSettings.remoteBrowserHost,
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Records when the browser tool is completed
	 * @param taskId Unique identifier for the task
	 * @param stats Statistics about the browser session
	 */
	public captureBrowserToolEnd(
		taskId: string,
		stats: {
			actionCount: number
			duration: number
			actions?: string[]
		},
	) {
		if (!this.isCategoryEnabled("browser")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.BROWSER_TOOL_END,
			properties: {
				taskId,
				actionCount: stats.actionCount,
				duration: stats.duration,
				actions: stats.actions,
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Records when browser errors occur during a task
	 * @param taskId Unique identifier for the task
	 * @param errorType Type of error that occurred (e.g., "launch_error", "connection_error", "navigation_error")
	 * @param errorMessage The error message
	 * @param context Additional context about where the error occurred
	 */
	public captureBrowserError(
		taskId: string,
		errorType: string,
		errorMessage: string,
		context?: {
			action?: string
			url?: string
			isRemote?: boolean
			[key: string]: any
		},
	) {
		if (!this.isCategoryEnabled("browser")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.BROWSER_ERROR,
			properties: {
				taskId,
				errorType,
				errorMessage,
				context,
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Records when a user selects an option from AI-generated followup questions
	 * @param taskId Unique identifier for the task
	 * @param qty The quantity of options that were presented
	 * @param mode The mode in which the option was selected ("plan" or "act")
	 */
	public captureOptionSelected(taskId: string, qty: number, mode: Mode) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.OPTION_SELECTED,
			properties: {
				taskId,
				qty,
				mode,
			},
		})
	}

	/**
	 * Records when a user types a custom response instead of selecting one of the AI-generated followup questions
	 * @param taskId Unique identifier for the task
	 * @param qty The quantity of options that were presented
	 * @param mode The mode in which the custom response was provided ("plan" or "act")
	 */
	public captureOptionsIgnored(taskId: string, qty: number, mode: Mode) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.OPTIONS_IGNORED,
			properties: {
				taskId,
				qty,
				mode,
			},
		})
	}

	/**
	 * Captures Gemini API performance metrics.
	 * @param taskId Unique identifier for the task
	 * @param modelId Specific Gemini model ID
	 * @param data Performance data including TTFT, durations, token counts, cache stats, and API success status
	 */
	public captureGeminiApiPerformance(
		taskId: string,
		modelId: string,
		data: {
			ttftSec?: number
			totalDurationSec?: number
			promptTokens: number
			outputTokens: number
			cacheReadTokens: number
			cacheHit: boolean
			cacheHitPercentage?: number
			apiSuccess: boolean
			apiError?: string
			throughputTokensPerSec?: number
		},
	) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.GEMINI_API_PERFORMANCE,
			properties: {
				taskId,
				modelId,
				...data,
			},
		})
	}

	/**
	 * Records when the user uses the model favorite button in the model picker
	 * @param model The name of the model the user has interacted with
	 * @param isFavorited Whether the model is being favorited (true) or unfavorited (false)
	 */
	public captureModelFavoritesUsage(model: string, isFavorited: boolean) {
		this.capture({
			event: TelemetryService.EVENTS.UI.MODEL_FAVORITE_TOGGLED,
			properties: {
				model,
				isFavorited,
			},
		})
	}

	public captureButtonClick(button: string, taskId?: string) {
		this.capture({
			event: TelemetryService.EVENTS.UI.BUTTON_CLICKED,
			properties: {
				button,
				taskId,
			},
		})
	}

	/**
	 * Records telemetry when an API provider returns an error
	 * @param taskId Unique identifier for the task
	 * @param model Identifier of the model used
	 * @param requestId Unique identifier for the specific API request
	 * @param errorMessage Detailed error message from the API provider
	 * @param errorStatus HTTP status code of the error response, if available
	 * @param collect Optional flag to determine if the event should be collected for batch sending
	 */
	public captureProviderApiError(args: {
		taskId: string
		model: string
		errorMessage: string
		errorStatus?: number | undefined
		requestId?: string | undefined
	}) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.PROVIDER_API_ERROR,
			properties: {
				...args,
				errorMessage: args.errorMessage.substring(0, MAX_ERROR_MESSAGE_LENGTH), // Truncate long error messages
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Checks if telemetry is enabled
	 * @returns Boolean indicating whether telemetry is enabled
	 */
	public isTelemetryEnabled(): boolean {
		return this.telemetryEnabled
	}

	/**
	 * Checks if a specific telemetry category is enabled
	 * @param category The telemetry category to check
	 * @returns Boolean indicating whether the specified telemetry category is enabled
	 */
	public isCategoryEnabled(category: TelemetryCategory): boolean {
		// Default to true if category has not been explicitly configured
		return this.telemetryCategoryEnabled.get(category) ?? true
	}

	public async shutdown(): Promise<void> {
		await this.client.shutdown()
	}
}

export const telemetryService = TelemetryService.getInstance()

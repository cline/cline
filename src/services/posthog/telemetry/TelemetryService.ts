import { HostProvider } from "@hosts/host-provider"
import type { BrowserSettings } from "@shared/BrowserSettings"
import { ShowMessageType } from "@shared/proto/host/window"
import type { TaskFeedbackType } from "@shared/WebviewMessage"
import * as vscode from "vscode"
import { ClineAccountUserInfo } from "@/services/auth/AuthService"
import { Mode } from "@/shared/storage/types"
import { version as extensionVersion } from "../../../../package.json"
import type { PostHogClientProvider } from "../PostHogClientProvider"

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
type TelemetryCategory = "checkpoints" | "browser" | "focus_chain"

/**
 * Maximum length for error messages to prevent excessive data
 */
const MAX_ERROR_MESSAGE_LENGTH = 500

export class TelemetryService {
	// Map to control specific telemetry categories (event types)
	private telemetryCategoryEnabled: Map<TelemetryCategory, boolean> = new Map([
		["checkpoints", true], // Checkpoints telemetry enabled
		["browser", true], // Browser telemetry enabled
		["focus_chain", true], // Focus Chain telemetry enabled
	])

	// Event constants for tracking user interactions and system events
	private static readonly EVENTS = {
		// Task-related events for tracking conversation and execution flow

		USER: {
			OPT_OUT: "user.opt_out",
			TELEMETRY_ENABLED: "user.telemetry_enabled",
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
			// Tracks when MCP tools are used
			MCP_TOOL_CALLED: "task.mcp_tool_called",
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
			// Tracks when users enable the focus chain feature
			FOCUS_CHAIN_ENABLED: "task.focus_chain_enabled",
			// Tracks when users disable the focus chain feature
			FOCUS_CHAIN_DISABLED: "task.focus_chain_disabled",
			// Tracks when the first focus chain return is returned by the model
			FOCUS_CHAIN_PROGRESS_FIRST: "task.focus_chain_progress_first",
			// Tracks when subsequent focus chain list returns are returned
			FOCUS_CHAIN_PROGRESS_UPDATE: "task.focus_chain_progress_update",
			// Tracks the statusn of the focus chain list when the task reaches a task completion state
			FOCUS_CHAIN_INCOMPLETE_ON_COMPLETION: "task.focus_chain_incomplete_on_completion",
			// Tracks when users click to open the focus chain markdfown file
			FOCUS_CHAIN_LIST_OPENED: "task.focus_chain_list_opened",
			// Tracks when users save and write to the focus chain markdown file
			FOCUS_CHAIN_LIST_WRITTEN: "task.focus_chain_list_written",
			// Tracks when the context window is auto-condensed with the summarize_task tool call
			AUTO_COMPACT: "task.summarize_task",
			// Tracks when slash commands or workflows are activated
			SLASH_COMMAND_USED: "task.slash_command_used",
			// Tracks when individual Cline rules are toggled on/off
			RULE_TOGGLED: "task.rule_toggled",
			// Tracks when auto condense setting is toggled on/off
			AUTO_CONDENSE_TOGGLED: "task.auto_condense_toggled",
			// Tracks task initialization timing
			INITIALIZATION: "task.initialization",
		},
		// UI interaction events for tracking user engagement
		UI: {
			// Tracks when a different model is selected
			MODEL_SELECTED: "ui.model_selected",
			// Tracks when users use the "favorite" button in the model picker
			MODEL_FAVORITE_TOGGLED: "ui.model_favorite_toggled",
			// Tracks when a button is clicked
			BUTTON_CLICKED: "ui.button_clicked",
			// Tracks when the rules menu button is clicked
			RULES_MENU_OPENED: "ui.rules_menu_opened",
		},
	}

	/** Current version of the extension */
	private readonly version: string = extensionVersion
	/** Whether the extension is running in development mode */
	private readonly isDev = process.env.IS_DEV

	/**
	 * Constructor that accepts a PostHogClientProvider instance
	 * @param provider PostHogClientProvider instance for sending analytics events
	 */
	public constructor(private provider: PostHogClientProvider) {
		this.capture({ event: TelemetryService.EVENTS.USER.TELEMETRY_ENABLED })
		console.info("[TelemetryService] Initialized with PostHogClientProvider")
	}

	/**
	 * Updates the telemetry state based on user preferences and VSCode settings
	 * Only enables telemetry if both VSCode global telemetry is enabled and user has opted in
	 * @param didUserOptIn Whether the user has explicitly opted into telemetry
	 */
	public async updateTelemetryState(didUserOptIn: boolean): Promise<void> {
		// First check global telemetry level - telemetry should only be enabled when level is "all"

		// We only enable telemetry if global vscode telemetry is enabled
		if (!vscode.env.isTelemetryEnabled) {
			// Only show warning if user has opted in to Cline telemetry but VS Code telemetry is disabled
			if (didUserOptIn) {
				const isVsCodeHost = vscode?.env?.uriScheme === "vscode"
				if (isVsCodeHost) {
					void HostProvider.window
						.showMessage({
							type: ShowMessageType.WARNING,
							message:
								"Anonymous Cline error and usage reporting is enabled, but VSCode telemetry is disabled. To enable error and usage reporting for this extension, enable VSCode telemetry in settings.",
							options: {
								items: ["Open Settings"],
							},
						})
						.then((response) => {
							if (response.selectedOption === "Open Settings") {
								void HostProvider.window.openSettings({ query: "telemetry.telemetryLevel" })
							}
						})
				} else {
					void HostProvider.window.showMessage({
						type: ShowMessageType.WARNING,
						message: "Anonymous Cline error and usage reporting is enabled, but host telemetry is disabled.",
					})
				}
			}
		}

		this.provider.toggleOptIn(didUserOptIn)
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
	public capture(event: { event: string; properties?: unknown }): void {
		const propertiesWithVersion = this.addProperties(event.properties)

		// Use the provider's log method instead of direct client capture
		this.provider.log(event.event, propertiesWithVersion)
	}

	public captureExtensionActivated() {
		// Use provider's log method for the activation event
		this.provider.log(TelemetryService.EVENTS.USER.EXTENSION_ACTIVATED)
	}

	/**
	 * Identifies the accounts user
	 * @param userInfo The user's information
	 */
	public identifyAccount(userInfo: ClineAccountUserInfo) {
		const propertiesWithVersion = this.addProperties({})

		// Use the provider's log method instead of direct client capture
		this.provider.identifyAccount(userInfo, propertiesWithVersion)
	}

	// Task events
	/**
	 * Records when a new task/conversation is started
	 * @param ulid Unique identifier for the new task
	 * @param apiProvider Optional API provider
	 */
	public captureTaskCreated(ulid: string, apiProvider?: string) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.CREATED,
			properties: { ulid, apiProvider },
		})
	}

	/**
	 * Records when a task/conversation is restarted
	 * @param ulid Unique identifier for the new task
	 * @param apiProvider Optional API provider
	 */
	public captureTaskRestarted(ulid: string, apiProvider?: string) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.RESTARTED,
			properties: { ulid, apiProvider },
		})
	}

	/**
	 * Records when cline calls the task completion_result tool signifying that cline is done with the task
	 * @param ulid Unique identifier for the task
	 */
	public captureTaskCompleted(ulid: string) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.COMPLETED,
			properties: { ulid },
		})
	}

	/**
	 * Captures that a message was sent, and includes the API provider and model used
	 * @param ulid Unique identifier for the task
	 * @param provider The API provider (e.g., OpenAI, Anthropic)
	 * @param model The specific model used (e.g., GPT-4, Claude)
	 * @param source The source of the message ("user" | "model"). Used to track message patterns and identify when users need to correct the model's responses.
	 * @param tokenUsage Optional token usage data
	 */
	public captureConversationTurnEvent(
		ulid: string,
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
		if (!ulid || !provider || !model || !source) {
			console.warn("TelemetryService: Missing required parameters for message capture")
			return
		}

		const properties: Record<string, unknown> = {
			ulid,
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
	 * @param ulid Unique identifier for the task
	 * @param tokensIn Number of input tokens consumed
	 * @param tokensOut Number of output tokens generated
	 * @param model The model used for token calculation
	 */
	public captureTokenUsage(ulid: string, tokensIn: number, tokensOut: number, model: string) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.TOKEN_USAGE,
			properties: {
				ulid,
				tokensIn,
				tokensOut,
				model,
			},
		})
	}

	/**
	 * Records when a task switches between plan and act modes
	 * @param ulid Unique identifier for the task
	 * @param mode The mode being switched to (plan or act)
	 */
	public captureModeSwitch(ulid: string, mode: Mode) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.MODE_SWITCH,
			properties: {
				ulid,
				mode,
			},
		})
	}

	/**
	 * Records when context summarization is triggered due to context window pressure
	 * @param ulid Unique identifier for the task
	 * @param modelId The model that triggered summarization
	 * @param currentTokens Total tokens in context window when summarization was triggered
	 * @param maxContextWindow Maximum context window size for the model
	 */
	public captureSummarizeTask(ulid: string, modelId: string, currentTokens: number, maxContextWindow: number) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.AUTO_COMPACT,
			properties: {
				ulid,
				modelId,
				currentTokens,
				maxContextWindow,
			},
		})
	}

	/**
	 * Records user feedback on completed tasks
	 * @param ulid Unique identifier for the task
	 * @param feedbackType The type of feedback ("thumbs_up" or "thumbs_down")
	 */
	public captureTaskFeedback(ulid: string, feedbackType: TaskFeedbackType) {
		console.info("TelemetryService: Capturing task feedback", {
			ulid,
			feedbackType,
		})
		this.capture({
			event: TelemetryService.EVENTS.TASK.FEEDBACK,
			properties: {
				ulid,
				feedbackType,
			},
		})
	}

	// Tool events
	/**
	 * Records when a tool is used during task execution
	 * @param ulid Unique identifier for the task
	 * @param tool Name of the tool being used
	 * @param autoApproved Whether the tool was auto-approved based on settings
	 * @param success Whether the tool execution was successful
	 */
	public captureToolUsage(ulid: string, tool: string, modelId: string, autoApproved: boolean, success: boolean) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.TOOL_USED,
			properties: {
				ulid,
				tool,
				autoApproved,
				success,
				modelId,
			},
		})
	}

	/**
	 * Records when an MCP tool is called.
	 * This telemetry event is designed to monitor the usage and performance of MCP tools
	 * without compromising user privacy. It captures the tool's metadata (server, name, and arguments)
	 * but explicitly avoids logging the values of the arguments.
	 *
	 * @param ulid Unique identifier for the task.
	 * @param serverName The name of the MCP server.
	 * @param toolName The name of the tool being called.
	 * @param status The status of the tool call.
	 * @param errorMessage Optional error message if the call failed.
	 * @param argumentKeys Optional array of argument keys for the tool.
	 */
	public captureMcpToolCall(
		ulid: string,
		serverName: string,
		toolName: string,
		status: "started" | "success" | "error",
		errorMessage?: string,
		argumentKeys?: string[],
	) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.MCP_TOOL_CALLED,
			properties: {
				ulid,
				serverName,
				toolName,
				status,
				errorMessage,
				argumentKeys,
			},
		})
	}

	/**
	 * Records interactions with the git-based checkpoint system
	 * @param ulid Unique identifier for the task
	 * @param action The type of checkpoint action
	 * @param durationMs Optional duration of the operation in milliseconds
	 */
	public captureCheckpointUsage(
		ulid: string,
		action: "shadow_git_initialized" | "commit_created" | "restored" | "diff_generated",
		durationMs?: number,
	) {
		if (!this.isCategoryEnabled("checkpoints")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.CHECKPOINT_USED,
			properties: {
				ulid,
				action,
				durationMs,
			},
		})
	}

	/**
	 * Records when a diff edit (replace_in_file) operation fails
	 * @param ulid Unique identifier for the task
	 * @param errorType Type of error that occurred (e.g., "search_not_found", "invalid_format")
	 */
	public captureDiffEditFailure(ulid: string, modelId: string, errorType?: string) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.DIFF_EDIT_FAILED,
			properties: {
				ulid,
				errorType,
				modelId,
			},
		})
	}

	/**
	 * Records when a different model is selected for use
	 * @param model Name of the selected model
	 * @param provider Provider of the selected model
	 * @param ulid Optional task identifier if model was selected during a task
	 */
	public captureModelSelected(model: string, provider: string, ulid?: string) {
		this.capture({
			event: TelemetryService.EVENTS.UI.MODEL_SELECTED,
			properties: {
				model,
				provider,
				ulid,
			},
		})
	}

	/**
	 * Records when the browser tool is started
	 * @param ulid Unique identifier for the task
	 * @param browserSettings The browser settings being used
	 */
	public captureBrowserToolStart(ulid: string, browserSettings: BrowserSettings) {
		if (!this.isCategoryEnabled("browser")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.BROWSER_TOOL_START,
			properties: {
				ulid,
				viewport: browserSettings.viewport,
				isRemote: !!browserSettings.remoteBrowserEnabled,
				remoteBrowserHost: browserSettings.remoteBrowserHost,
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Records when the browser tool is completed
	 * @param ulid Unique identifier for the task
	 * @param stats Statistics about the browser session
	 */
	public captureBrowserToolEnd(
		ulid: string,
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
				ulid,
				actionCount: stats.actionCount,
				duration: stats.duration,
				actions: stats.actions,
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Records when browser errors occur during a task
	 * @param ulid Unique identifier for the task
	 * @param errorType Type of error that occurred (e.g., "launch_error", "connection_error", "navigation_error")
	 * @param errorMessage The error message
	 * @param context Additional context about where the error occurred
	 */
	public captureBrowserError(
		ulid: string,
		errorType: string,
		errorMessage: string,
		context?: {
			action?: string
			url?: string
			isRemote?: boolean
			[key: string]: unknown
		},
	) {
		if (!this.isCategoryEnabled("browser")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.BROWSER_ERROR,
			properties: {
				ulid,
				errorType,
				errorMessage,
				context,
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Records when a user selects an option from AI-generated followup questions
	 * @param ulid Unique identifier for the task
	 * @param qty The quantity of options that were presented
	 * @param mode The mode in which the option was selected ("plan" or "act")
	 */
	public captureOptionSelected(ulid: string, qty: number, mode: Mode) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.OPTION_SELECTED,
			properties: {
				ulid,
				qty,
				mode,
			},
		})
	}

	/**
	 * Records when a user types a custom response instead of selecting one of the AI-generated followup questions
	 * @param ulid Unique identifier for the task
	 * @param qty The quantity of options that were presented
	 * @param mode The mode in which the custom response was provided ("plan" or "act")
	 */
	public captureOptionsIgnored(ulid: string, qty: number, mode: Mode) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.OPTIONS_IGNORED,
			properties: {
				ulid,
				qty,
				mode,
			},
		})
	}

	/**
	 * Captures Gemini API performance metrics.
	 * @param ulid Unique identifier for the task
	 * @param modelId Specific Gemini model ID
	 * @param data Performance data including TTFT, durations, token counts, cache stats, and API success status
	 */
	public captureGeminiApiPerformance(
		ulid: string,
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
				ulid,
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

	public captureButtonClick(button: string, ulid?: string) {
		this.capture({
			event: TelemetryService.EVENTS.UI.BUTTON_CLICKED,
			properties: {
				button,
				ulid,
			},
		})
	}

	/**
	 * Records telemetry when an API provider returns an error
	 * @param ulid Unique identifier for the task
	 * @param model Identifier of the model used
	 * @param requestId Unique identifier for the specific API request
	 * @param errorMessage Detailed error message from the API provider
	 * @param errorStatus HTTP status code of the error response, if available
	 * @param collect Optional flag to determine if the event should be collected for batch sending
	 */
	public captureProviderApiError(args: {
		ulid: string
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
	 * Records when focus chain is enabled/disabled by the user
	 * @param enabled Whether focus chain was enabled (true) or disabled (false)
	 */
	public captureFocusChainToggle(enabled: boolean) {
		if (!this.isCategoryEnabled("focus_chain")) {
			return
		}

		this.capture({
			event: enabled ? TelemetryService.EVENTS.TASK.FOCUS_CHAIN_ENABLED : TelemetryService.EVENTS.TASK.FOCUS_CHAIN_DISABLED,
			properties: {
				enabled,
			},
		})
	}

	/**
	 * Records when a task progress list is returned by the model for the first time in a task
	 * @param ulid Unique identifier for the task
	 * @param totalItems Number of items in the initial focus chain list
	 */
	public captureFocusChainProgressFirst(ulid: string, totalItems: number) {
		if (!this.isCategoryEnabled("focus_chain")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.FOCUS_CHAIN_PROGRESS_FIRST,
			properties: {
				ulid,
				totalItems,
			},
		})
	}

	/**
	 * Records when a task progress list is updated by the model mid-task
	 * @param ulid Unique identifier for the task
	 * @param totalItems Total number of items in the focus chain list
	 * @param completedItems Number of completed items in the focus chain list
	 */
	public captureFocusChainProgressUpdate(ulid: string, totalItems: number, completedItems: number) {
		if (!this.isCategoryEnabled("focus_chain")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.FOCUS_CHAIN_PROGRESS_UPDATE,
			properties: {
				ulid,
				totalItems,
				completedItems,
				completionPercentage: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
			},
		})
	}

	/**
	 * Records when a task ends but the task progress list is not complete
	 * @param ulid Unique identifier for the task
	 * @param totalItems Total number of items in the focus chain list
	 * @param completedItems Number of completed items
	 * @param incompleteItems Number of incomplete items
	 */
	public captureFocusChainIncompleteOnCompletion(
		ulid: string,
		totalItems: number,
		completedItems: number,
		incompleteItems: number,
	) {
		if (!this.isCategoryEnabled("focus_chain")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.FOCUS_CHAIN_INCOMPLETE_ON_COMPLETION,
			properties: {
				ulid,
				totalItems,
				completedItems,
				incompleteItems,
				completionPercentage: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
			},
		})
	}

	/**
	 * Records when users click to open the focus chain markdown file
	 * @param ulid Unique identifier for the task
	 */
	public captureFocusChainListOpened(ulid: string) {
		if (!this.isCategoryEnabled("focus_chain")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.FOCUS_CHAIN_LIST_OPENED,
			properties: {
				ulid,
			},
		})
	}

	/**
	 * Records when users save and write to the focus chain markdown file
	 * @param ulid Unique identifier for the task
	 */
	public captureFocusChainListWritten(ulid: string) {
		if (!this.isCategoryEnabled("focus_chain")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.TASK.FOCUS_CHAIN_LIST_WRITTEN,
			properties: {
				ulid,
			},
		})
	}

	/**
	 * Records when slash commands or workflows are activated
	 * @param ulid Unique identifier for the task
	 * @param commandName The name of the command (e.g., "newtask", "reportbug", or custom workflow name)
	 * @param commandType Whether it's a built-in command or custom workflow
	 */
	public captureSlashCommandUsed(ulid: string, commandName: string, commandType: "builtin" | "workflow") {
		this.capture({
			event: TelemetryService.EVENTS.TASK.SLASH_COMMAND_USED,
			properties: {
				ulid,
				commandName,
				commandType,
			},
		})
	}

	/**
	 * Records when individual Cline rules are toggled on/off
	 * @param ulid Unique identifier for the task (to track rule changes within task context)
	 * @param ruleFileName The filename of the rule (sanitized to exclude full path)
	 * @param enabled Whether the rule is being enabled (true) or disabled (false)
	 * @param isGlobal Whether this is a global rule or workspace-specific rule
	 */
	public captureClineRuleToggled(ulid: string, ruleFileName: string, enabled: boolean, isGlobal: boolean) {
		// Sanitize filename to remove any path information for privacy
		const sanitizedFileName = ruleFileName.split("/").pop() || ruleFileName.split("\\").pop() || ruleFileName

		this.capture({
			event: TelemetryService.EVENTS.TASK.RULE_TOGGLED,
			properties: {
				ulid,
				ruleFileName: sanitizedFileName,
				enabled,
				isGlobal,
			},
		})
	}

	/**
	 * Records when auto condense is enabled/disabled by the user
	 * @param ulid Unique identifier for the task
	 * @param enabled Whether auto condense was enabled (true) or disabled (false)
	 * @param modelId The model ID being used when the toggle occurred
	 */
	public captureAutoCondenseToggle(ulid: string, enabled: boolean, modelId: string) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.AUTO_CONDENSE_TOGGLED,
			properties: {
				ulid,
				enabled,
				modelId,
			},
		})
	}

	/**
	 * Records task initialization timing and metadata
	 * @param ulid Unique identifier for the task
	 * @param taskId Task ID (timestamp in milliseconds when task was created)
	 * @param durationMs Duration of initialization in milliseconds
	 * @param hasCheckpoints Whether checkpoints are enabled for this task
	 */
	public captureTaskInitialization(ulid: string, taskId: string, durationMs: number, hasCheckpoints: boolean) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.INITIALIZATION,
			properties: {
				ulid,
				taskId,
				durationMs,
				hasCheckpoints,
			},
		})
	}

	/**
	 * Records when the rules menu button is clicked to open the rules/workflows modal
	 */
	public captureRulesMenuOpened() {
		this.capture({
			event: TelemetryService.EVENTS.UI.RULES_MENU_OPENED,
			properties: {},
		})
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
}

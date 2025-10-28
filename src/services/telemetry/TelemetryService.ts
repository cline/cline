import { HostProvider } from "@hosts/host-provider"
import type { BrowserSettings } from "@shared/BrowserSettings"
import { ShowMessageType } from "@shared/proto/host/window"
import type { TaskFeedbackType } from "@shared/WebviewMessage"
import * as os from "os"
import { ClineAccountUserInfo } from "@/services/auth/AuthService"
import { Setting } from "@/shared/proto/index.host"
import { Mode } from "@/shared/storage/types"
import { version as extensionVersion } from "../../../package.json"
import { setDistinctId } from "../logging/distinctId"
import type { ITelemetryProvider, TelemetryProperties } from "./providers/ITelemetryProvider"
import { TelemetryProviderFactory } from "./TelemetryProviderFactory"

/**
 * Represents telemetry event categories that can be individually enabled or disabled
 * When adding a new category, add it both here and to the initial values in telemetryCategoryEnabled
 * Ensure `if (!this.isCategoryEnabled('<category_name>')` is added to the capture method
 */
type TelemetryCategory = "checkpoints" | "browser" | "focus_chain" | "dictation" | "subagents"

/**
 * Enum for terminal output failure reasons
 */
export enum TerminalOutputFailureReason {
	TIMEOUT = "timeout",
	NO_SHELL_INTEGRATION = "no_shell_integration",
	CLIPBOARD_FAILED = "clipboard_failed",
}

/**
 * Enum for terminal user intervention actions
 */
export enum TerminalUserInterventionAction {
	PROCESS_WHILE_RUNNING = "process_while_running",
	MANUAL_PASTE = "manual_paste",
	CANCELLED = "cancelled",
}

/**
 * Enum for terminal hang stages
 */
export enum TerminalHangStage {
	WAITING_FOR_COMPLETION = "waiting_for_completion",
	BUFFER_STUCK = "buffer_stuck",
	STREAM_TIMEOUT = "stream_timeout",
}

export type TelemetryMetadata = {
	/** The extension or cline-core version. */
	extension_version: string
	/** The name of the host IDE or environment e.g. VSCode */
	platform: string
	/** The version of the host environment */
	platform_version: string
	/** The operating system type, e.g. darwin, win32. This is the value returned by os.platform() */
	os_type: string
	/** The operating system version e.g. 'Windows 10 Pro', 'Darwin Kernel Version 21.6.0...'
	 * This is the value returned by os.version() */
	os_version: string
	/** Whether the extension is running in development mode */
	is_dev: string | undefined
}

/**
 * Maximum length for error messages to prevent excessive data
 */
const MAX_ERROR_MESSAGE_LENGTH = 500

/**
 * TelemetryService handles telemetry event tracking for the Cline extension
 * Uses an abstracted telemetry provider to support multiple analytics backends
 * Respects user privacy settings and VSCode's global telemetry configuration
 */
export class TelemetryService {
	// Map to control specific telemetry categories (event types)
	private telemetryCategoryEnabled: Map<TelemetryCategory, boolean> = new Map([
		["checkpoints", true], // Checkpoints telemetry enabled
		["browser", true], // Browser telemetry enabled
		["dictation", true], // Dictation telemetry enabled
		["focus_chain", true], // Focus Chain telemetry enabled
		["subagents", true], // CLI Subagents telemetry enabled
	])

	// Event constants for tracking user interactions and system events
	private static readonly EVENTS = {
		// Task-related events for tracking conversation and execution flow

		USER: {
			OPT_OUT: "user.opt_out",
			TELEMETRY_ENABLED: "user.telemetry_enabled",
			EXTENSION_ACTIVATED: "user.extension_activated",
			AUTH_STARTED: "user.auth_started",
			AUTH_SUCCEEDED: "user.auth_succeeded",
			AUTH_FAILED: "user.auth_failed",
			AUTH_LOGGED_OUT: "user.auth_logged_out",
		},
		DICTATION: {
			// Tracks when voice recording is started
			RECORDING_STARTED: "voice.recording_started",
			// Tracks when voice recording is stopped
			RECORDING_STOPPED: "voice.recording_stopped",
			// Tracks when voice transcription is started
			TRANSCRIPTION_STARTED: "voice.transcription_started",
			// Tracks when voice transcription is completed successfully
			TRANSCRIPTION_COMPLETED: "voice.transcription_completed",
			// Tracks when voice transcription fails
			TRANSCRIPTION_ERROR: "voice.transcription_error",
			// Tracks when voice feature is enabled or disabled in settings
		},
		// Workspace-related events for multi-root support
		WORKSPACE: {
			// Track workspace initialization
			INITIALIZED: "workspace.initialized",
			// Track initialization errors
			INIT_ERROR: "workspace.init_error",
			// Track VCS detection
			VCS_DETECTED: "workspace.vcs_detected",
			// Track multi-root checkpoint operations
			MULTI_ROOT_CHECKPOINT: "workspace.multi_root_checkpoint",
			// Track workspace resolution
			PATH_RESOLVED: "workspace.path_resolved",
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
			// Tracks when yolo mode setting is toggled on/off
			YOLO_MODE_TOGGLED: "task.yolo_mode_toggled",
			// Tracks task initialization timing
			INITIALIZATION: "task.initialization",
			// Terminal execution telemetry events
			TERMINAL_EXECUTION: "task.terminal_execution",
			TERMINAL_OUTPUT_FAILURE: "task.terminal_output_failure",
			TERMINAL_USER_INTERVENTION: "task.terminal_user_intervention",
			TERMINAL_HANG: "task.terminal_hang",
			// Mention telemetry events
			MENTION_USED: "task.mention_used",
			MENTION_FAILED: "task.mention_failed",
			MENTION_SEARCH_RESULTS: "task.mention_search_results",
			// Multi-workspace search pattern tracking
			WORKSPACE_SEARCH_PATTERN: "task.workspace_search_pattern",
			// CLI Subagents telemetry events
			SUBAGENT_ENABLED: "task.subagent_enabled",
			SUBAGENT_DISABLED: "task.subagent_disabled",
			SUBAGENT_STARTED: "task.subagent_started",
			SUBAGENT_COMPLETED: "task.subagent_completed",
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

	public static async create(): Promise<TelemetryService> {
		const providers = await TelemetryProviderFactory.createProviders()
		const hostVersion = await HostProvider.env.getHostVersion({})
		const metadata: TelemetryMetadata = {
			extension_version: extensionVersion,
			platform: hostVersion.platform || "unknown",
			platform_version: hostVersion.version || "unknown",
			os_type: os.platform(),
			os_version: os.version(),
			is_dev: process.env.IS_DEV,
		}
		return new TelemetryService(providers, metadata)
	}

	/**
	 * Constructor that accepts multiple telemetry providers for dual tracking
	 * @param providers Array of telemetry providers for dual/multi tracking
	 */
	constructor(
		private providers: ITelemetryProvider[],
		private telemetryMetadata: TelemetryMetadata,
	) {
		this.capture({ event: TelemetryService.EVENTS.USER.TELEMETRY_ENABLED })
		console.info(`[TelemetryService] Initialized with ${providers.length} telemetry provider(s)`)
	}

	/**
	 * Updates the telemetry state based on user preferences and VSCode settings
	 * Only enables telemetry if both VSCode global telemetry is enabled and user has opted in
	 * @param didUserOptIn Whether the user has explicitly opted into telemetry
	 */
	public async updateTelemetryState(didUserOptIn: boolean): Promise<void> {
		// First check global telemetry level - telemetry should only be enabled when level is "all"

		// We only enable telemetry if global host telemetry is enabled
		const hostSetting = await HostProvider.env.getTelemetrySettings({})
		if (hostSetting.isEnabled === Setting.DISABLED) {
			// Only show warning if user has opted in to Cline telemetry but host telemetry is disabled
			if (didUserOptIn) {
				void HostProvider.window
					.showMessage({
						type: ShowMessageType.WARNING,
						message:
							"Anonymous Cline error and usage reporting is enabled, but IDE telemetry is disabled. To enable error and usage reporting for this extension, enable telemetry in IDE settings.",
						options: {
							items: ["Open Settings"],
						},
					})
					.then((response: { selectedOption?: string }) => {
						if (response.selectedOption === "Open Settings") {
							void HostProvider.window.openSettings({
								query: "telemetry.telemetryLevel",
							})
						}
					})
			}
		}

		// Update all providers
		this.providers.forEach((provider) => {
			provider.setOptIn(didUserOptIn)
		})
	}

	/**
	 * Captures a telemetry event if telemetry is enabled
	 * @param event The event to capture with its properties
	 */
	public capture(event: { event: string; properties?: TelemetryProperties }): void {
		const propertiesWithMetadata: TelemetryProperties = {
			...(event.properties || {}),
			...this.telemetryMetadata,
		}
		this.captureToProviders(event.event, propertiesWithMetadata, false)
	}

	/**
	 * Captures a required telemetry event that bypasses user opt-out settings
	 * @param event The event name to capture
	 * @param properties Optional properties to attach to the event
	 */
	public captureRequired(event: string, properties?: TelemetryProperties): void {
		const propertiesWithMetadata: TelemetryProperties = {
			...(properties || {}),
			...this.telemetryMetadata,
		}
		this.captureToProviders(event, propertiesWithMetadata, true)
	}

	/**
	 * Internal method to capture events to all providers with error isolation
	 * @param event The event name
	 * @param properties Event properties (must be JSON-serializable)
	 * @param required Whether this is a required event
	 */
	private captureToProviders(event: string, properties: TelemetryProperties, required: boolean): void {
		this.providers.forEach((provider) => {
			try {
				if (required) {
					provider.logRequired(event, properties)
				} else {
					provider.log(event, properties)
				}
			} catch (error) {
				console.error(`[TelemetryService] Provider failed for event ${event}:`, error)
			}
		})
	}

	public captureExtensionActivated() {
		this.captureToProviders(TelemetryService.EVENTS.USER.EXTENSION_ACTIVATED, {}, false)
	}

	/**
	 * Records when authentication flow is started
	 * @param provider The authentication provider being used
	 */
	public captureAuthStarted(provider?: string) {
		this.capture({
			event: TelemetryService.EVENTS.USER.AUTH_STARTED,
			properties: {
				provider,
			},
		})
	}

	/**
	 * Records when authentication flow succeeds
	 * @param provider The authentication provider that was used
	 */
	public captureAuthSucceeded(provider?: string) {
		this.capture({
			event: TelemetryService.EVENTS.USER.AUTH_SUCCEEDED,
			properties: {
				provider,
			},
		})
	}

	/**
	 * Records when authentication flow fails
	 * @param provider The authentication provider that was used
	 */
	public captureAuthFailed(provider?: string) {
		this.capture({
			event: TelemetryService.EVENTS.USER.AUTH_FAILED,
			properties: {
				provider,
			},
		})
	}

	/**
	 * Records when user logs out of their account
	 * @param provider The authentication provider that was used
	 * @param reason The reason for logout (user action, cross-window sync, error, etc.)
	 */
	public captureAuthLoggedOut(provider?: string, reason?: string) {
		this.capture({
			event: TelemetryService.EVENTS.USER.AUTH_LOGGED_OUT,
			properties: {
				provider,
				reason,
			},
		})
	}

	/**
	 * Identifies the accounts user
	 * @param userInfo The user's information
	 */
	public identifyAccount(userInfo: ClineAccountUserInfo) {
		const propertiesWithMetadata: TelemetryProperties = {
			...this.telemetryMetadata,
		}

		// Update all providers with error isolation
		this.providers.forEach((provider) => {
			try {
				provider.identifyUser(userInfo, propertiesWithMetadata)
			} catch (error) {
				console.error(`[TelemetryService] Provider failed for user identification:`, error)
			}
		})

		if (userInfo.id) {
			setDistinctId(userInfo.id)
		}
	}

	// Dictation events
	/**
	 * Records when voice recording is started
	 * @param taskId Optional task identifier if recording was started during a task
	 * @param platform The platform where recording is happening (macOS, Windows, Linux)
	 */
	public captureVoiceRecordingStarted(taskId?: string, platform?: string) {
		if (!this.isCategoryEnabled("dictation")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.DICTATION.RECORDING_STARTED,
			properties: {
				taskId,
				platform: platform ?? process.platform,
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Records when voice recording is stopped
	 * @param taskId Optional task identifier if recording was stopped during a task
	 * @param durationMs Duration of the recording in milliseconds
	 * @param success Whether the recording was successful
	 * @param platform The platform where recording happened
	 */
	public captureVoiceRecordingStopped(taskId?: string, durationMs?: number, success?: boolean, platform?: string) {
		if (!this.isCategoryEnabled("dictation")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.DICTATION.RECORDING_STOPPED,
			properties: {
				taskId,
				durationMs,
				success,
				platform: platform ?? process.platform,
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Records when voice transcription is started
	 * @param taskId Optional task identifier if transcription was started during a task
	 * @param language Language hint provided for transcription
	 */
	public captureVoiceTranscriptionStarted(taskId?: string, language?: string) {
		if (!this.isCategoryEnabled("dictation")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.DICTATION.TRANSCRIPTION_STARTED,
			properties: {
				taskId,
				language,
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Records when voice transcription is completed successfully
	 * @param taskId Optional task identifier if transcription was completed during a task
	 * @param transcriptionLength Length of the transcribed text
	 * @param durationMs Time taken for transcription in milliseconds
	 * @param language Language used for transcription
	 * @param isOrgAccount Whether the transcription was done using an organization account
	 */
	public captureVoiceTranscriptionCompleted(
		taskId?: string,
		transcriptionLength?: number,
		durationMs?: number,
		language?: string,
		isOrgAccount?: boolean,
	) {
		if (!this.isCategoryEnabled("dictation")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.DICTATION.TRANSCRIPTION_COMPLETED,
			properties: {
				taskId,
				transcriptionLength,
				durationMs,
				language,
				accountType: isOrgAccount ? "organization" : "personal",
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Records when voice transcription fails
	 * @param taskId Optional task identifier if transcription failed during a task
	 * @param errorType Type of error that occurred (e.g., "no_openai_key", "api_error", "network_error")
	 * @param errorMessage The error message
	 * @param durationMs Time taken before failure in milliseconds
	 */
	public captureVoiceTranscriptionError(taskId?: string, errorType?: string, errorMessage?: string, durationMs?: number) {
		if (!this.isCategoryEnabled("dictation")) {
			return
		}

		this.capture({
			event: TelemetryService.EVENTS.DICTATION.TRANSCRIPTION_ERROR,
			properties: {
				taskId,
				errorType,
				errorMessage,
				durationMs,
				timestamp: new Date().toISOString(),
			},
		})
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

		this.capture({
			event: TelemetryService.EVENTS.TASK.CONVERSATION_TURN,
			properties: {
				ulid,
				provider,
				model,
				source,
				timestamp: new Date().toISOString(), // Add timestamp for message sequencing
				...tokenUsage,
			},
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
	 * @param modelId The model ID being used
	 * @param autoApproved Whether the tool was auto-approved based on settings
	 * @param success Whether the tool execution was successful
	 * @param workspaceContext Optional workspace context for multi-root workspace tracking
	 */
	public captureToolUsage(
		ulid: string,
		tool: string,
		modelId: string,
		autoApproved: boolean,
		success: boolean,
		workspaceContext?: {
			isMultiRootEnabled: boolean
			usedWorkspaceHint: boolean
			resolvedToNonPrimary: boolean
			resolutionMethod: "hint" | "primary_fallback" | "path_detection"
		},
	) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.TOOL_USED,
			properties: {
				ulid,
				tool,
				autoApproved,
				success,
				modelId,
				// Workspace context (optional)
				...(workspaceContext && {
					workspace_multi_root_enabled: workspaceContext.isMultiRootEnabled,
					workspace_hint_used: workspaceContext.usedWorkspaceHint,
					workspace_resolved_non_primary: workspaceContext.resolvedToNonPrimary,
					workspace_resolution_method: workspaceContext.resolutionMethod,
				}),
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
			remoteBrowserHost?: string
			endpoint?: string
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
				...(context && { context }),
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
		provider?: string
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
	 * Records when yolo mode is enabled/disabled by the user
	 * @param ulid Unique identifier for the task
	 * @param enabled Whether yolo mode was enabled (true) or disabled (false)
	 */
	public captureYoloModeToggle(ulid: string, enabled: boolean) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.YOLO_MODE_TOGGLED,
			properties: {
				ulid,
				enabled,
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

	// Terminal telemetry methods

	/**
	 * Records terminal command execution outcomes
	 * @param success Whether the command output was successfully captured
	 * @param method The method used to capture output ("shell_integration" | "clipboard" | "none")
	 */
	public captureTerminalExecution(success: boolean, method: "shell_integration" | "clipboard" | "none") {
		this.capture({
			event: TelemetryService.EVENTS.TASK.TERMINAL_EXECUTION,
			properties: {
				success,
				method,
			},
		})
	}

	/**
	 * Records when terminal output capture fails
	 * @param reason The reason for failure
	 */
	public captureTerminalOutputFailure(reason: TerminalOutputFailureReason) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.TERMINAL_OUTPUT_FAILURE,
			properties: {
				reason,
			},
		})
	}

	/**
	 * Records when user has to intervene with terminal execution
	 * @param action The user action
	 */
	public captureTerminalUserIntervention(action: TerminalUserInterventionAction) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.TERMINAL_USER_INTERVENTION,
			properties: {
				action,
			},
		})
	}

	/**
	 * Records when terminal execution hangs or gets stuck
	 * @param stage Where the hang occurred
	 */
	public captureTerminalHang(stage: TerminalHangStage) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.TERMINAL_HANG,
			properties: {
				stage,
			},
		})
	}

	// Workspace telemetry methods

	/**
	 * Records when workspace is initialized
	 * @param rootCount Number of workspace roots
	 * @param vcsTypes Array of VCS types detected
	 * @param initDurationMs Time taken to initialize in milliseconds
	 * @param featureFlagEnabled Whether multi-root feature flag is enabled
	 */
	public captureWorkspaceInitialized(
		rootCount: number,
		vcsTypes: string[],
		initDurationMs?: number,
		featureFlagEnabled?: boolean,
	) {
		this.capture({
			event: TelemetryService.EVENTS.WORKSPACE.INITIALIZED,
			properties: {
				root_count: rootCount,
				vcs_types: vcsTypes,
				is_multi_root: rootCount > 1,
				has_git: vcsTypes.includes("Git"),
				has_mercurial: vcsTypes.includes("Mercurial"),
				init_duration_ms: initDurationMs,
				feature_flag_enabled: featureFlagEnabled,
			},
		})
	}

	/**
	 * Records workspace initialization errors
	 * @param error The error that occurred
	 * @param fallbackMode Whether system fell back to single-root mode
	 * @param workspaceCount Number of workspace folders detected
	 */
	public captureWorkspaceInitError(error: Error, fallbackMode: boolean, workspaceCount?: number) {
		this.capture({
			event: TelemetryService.EVENTS.WORKSPACE.INIT_ERROR,
			properties: {
				error_type: error.constructor.name,
				error_message: error.message.substring(0, MAX_ERROR_MESSAGE_LENGTH),
				fallback_to_single_root: fallbackMode,
				workspace_count: workspaceCount ?? 0,
			},
		})
	}

	/**
	 * Records multi-root checkpoint operations
	 * @param ulid Task identifier
	 * @param action Type of checkpoint action
	 * @param rootCount Number of roots being checkpointed
	 * @param successCount Number of successful checkpoints
	 * @param failureCount Number of failed checkpoints
	 * @param durationMs Total operation duration in milliseconds
	 */
	public captureMultiRootCheckpoint(
		ulid: string,
		action: "initialized" | "committed" | "restored",
		rootCount: number,
		successCount: number,
		failureCount: number,
		durationMs?: number,
	) {
		this.capture({
			event: TelemetryService.EVENTS.WORKSPACE.MULTI_ROOT_CHECKPOINT,
			properties: {
				ulid,
				action,
				root_count: rootCount,
				success_count: successCount,
				failure_count: failureCount,
				success_rate: rootCount > 0 ? successCount / rootCount : 0,
				duration_ms: durationMs,
			},
		})
	}

	/**
	 * Records workspace path resolution events
	 * @param ulid Unique identifier for the task
	 * @param context The component/handler where resolution occurred
	 * @param resolutionType Type of resolution performed
	 * @param hintType Type of workspace hint provided (if any)
	 * @param resolutionSuccess Whether the resolution was successful
	 * @param targetWorkspaceIndex Index of the resolved workspace (0=primary, 1=secondary, etc.)
	 * @param isMultiRootEnabled Whether multi-root mode is enabled
	 */
	public captureWorkspacePathResolved(
		ulid: string,
		context: string,
		resolutionType: "hint_provided" | "fallback_to_primary" | "cross_workspace_search",
		hintType?: "workspace_name" | "workspace_path" | "invalid",
		resolutionSuccess?: boolean,
		targetWorkspaceIndex?: number,
		isMultiRootEnabled?: boolean,
	) {
		this.capture({
			event: TelemetryService.EVENTS.WORKSPACE.PATH_RESOLVED,
			properties: {
				ulid,
				context,
				resolution_type: resolutionType,
				hint_type: hintType,
				resolution_success: resolutionSuccess,
				target_workspace_index: targetWorkspaceIndex,
				is_multi_root_enabled: isMultiRootEnabled,
			},
		})
	}

	/**
	 * Records multi-workspace search patterns and performance
	 * @param ulid Unique identifier for the task
	 * @param searchType Type of search performed
	 * @param workspaceCount Number of workspaces searched
	 * @param hintProvided Whether a workspace hint was provided
	 * @param resultsFound Whether search results were found
	 * @param searchDurationMs Optional search duration in milliseconds
	 */
	public captureWorkspaceSearchPattern(
		ulid: string,
		searchType: "targeted" | "cross_workspace" | "primary_only",
		workspaceCount: number,
		hintProvided: boolean,
		resultsFound: boolean,
		searchDurationMs?: number,
	) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.WORKSPACE_SEARCH_PATTERN,
			properties: {
				ulid,
				search_type: searchType,
				workspace_count: workspaceCount,
				hint_provided: hintProvided,
				results_found: resultsFound,
				search_duration_ms: searchDurationMs,
			},
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

	/**
	 * Get the telemetry provider instances
	 * @returns The array of telemetry providers
	 */
	public getProviders(): ITelemetryProvider[] {
		return [...this.providers]
	}

	/**
	 * Check if telemetry is currently enabled
	 * @returns Boolean indicating whether any provider is enabled
	 */
	public isEnabled(): boolean {
		return this.providers.some((provider) => provider.isEnabled())
	}

	/**
	 * Get current telemetry settings from the first provider
	 * @returns Current telemetry settings
	 */
	public getSettings() {
		return this.providers.length > 0
			? this.providers[0].getSettings()
			: {
					extensionEnabled: false,
					hostEnabled: false,
					level: "off" as const,
				}
	}

	/**
	 * Records when a mention is successfully used and content is retrieved
	 * @param mentionType Type of mention (file, folder, url, problems, terminal, git-changes, commit)
	 * @param contentLength Optional length of content retrieved (for size tracking)
	 */
	public captureMentionUsed(
		mentionType: "file" | "folder" | "url" | "problems" | "terminal" | "git-changes" | "commit",
		contentLength?: number,
	) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.MENTION_USED,
			properties: {
				mentionType,
				contentLength,
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Records when a mention fails to retrieve content
	 * @param mentionType Type of mention that failed
	 * @param errorType Category of error (not_found, permission_denied, network_error, parse_error)
	 * @param errorMessage Optional error message for debugging (will be truncated)
	 */
	public captureMentionFailed(
		mentionType: "file" | "folder" | "url" | "problems" | "terminal" | "git-changes" | "commit",
		errorType: "not_found" | "permission_denied" | "network_error" | "parse_error" | "unknown",
		errorMessage?: string,
	) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.MENTION_FAILED,
			properties: {
				mentionType,
				errorType,
				errorMessage: errorMessage?.substring(0, MAX_ERROR_MESSAGE_LENGTH),
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Records search results when user searches for files/folders in mention dropdown
	 * @param query The search query entered by user
	 * @param resultCount Number of results returned
	 * @param searchType Type of search (file, folder, or all)
	 * @param isEmpty Whether the search returned no results
	 */
	public captureMentionSearchResults(
		query: string,
		resultCount: number,
		searchType: "file" | "folder" | "all",
		isEmpty: boolean,
	) {
		this.capture({
			event: TelemetryService.EVENTS.TASK.MENTION_SEARCH_RESULTS,
			properties: {
				queryLength: query.length,
				resultCount,
				searchType,
				isEmpty,
				timestamp: new Date().toISOString(),
			},
		})
	}

	// CLI Subagents telemetry methods

	/**
	 * Records when CLI subagents feature is enabled/disabled by the user
	 * @param enabled Whether subagents was enabled (true) or disabled (false)
	 */
	public captureSubagentToggle(enabled: boolean) {
		if (!this.isCategoryEnabled("subagents")) {
			return
		}

		this.capture({
			event: enabled ? TelemetryService.EVENTS.TASK.SUBAGENT_ENABLED : TelemetryService.EVENTS.TASK.SUBAGENT_DISABLED,
			properties: {
				enabled,
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Records when a CLI subagent is executed
	 * @param ulid Unique identifier for the task
	 * @param durationMs Duration of the subagent execution in milliseconds
	 * @param outputLines Number of lines of output produced by the subagent
	 * @param success Whether the subagent execution was successful
	 */
	public captureSubagentExecution(ulid: string, durationMs: number, outputLines: number, success: boolean) {
		if (!this.isCategoryEnabled("subagents")) {
			return
		}

		this.capture({
			event: success ? TelemetryService.EVENTS.TASK.SUBAGENT_COMPLETED : TelemetryService.EVENTS.TASK.SUBAGENT_STARTED,
			properties: {
				ulid,
				durationMs,
				outputLines,
				success,
				timestamp: new Date().toISOString(),
			},
		})
	}

	/**
	 * Clean up resources when the service is disposed
	 */
	public async dispose(): Promise<void> {
		const disposePromises = this.providers.map((provider) => provider.dispose())
		await Promise.allSettled(disposePromises)
	}
}

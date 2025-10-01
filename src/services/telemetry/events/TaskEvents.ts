import type { TaskFeedbackType } from "@shared/WebviewMessage"
import { Mode } from "@/shared/storage/types"
import type { TelemetryProperties } from "../providers/ITelemetryProvider"
import type { TelemetryService } from "../TelemetryService"
import { EventHandlerBase } from "./EventHandlerBase"

/**
 * Property types for task telemetry events
 */

export interface TaskCreatedProperties extends TelemetryProperties {
	ulid: string
	apiProvider?: string
}

export interface TaskCompletedProperties extends TelemetryProperties {
	ulid: string
}

export interface TaskFeedbackProperties extends TelemetryProperties {
	ulid: string
	feedbackType: TaskFeedbackType
}

export interface ConversationTurnProperties extends TelemetryProperties {
	ulid: string
	provider: string
	model: string
	source: "user" | "assistant"
	timestamp: string
	tokensIn?: number
	tokensOut?: number
	cacheWriteTokens?: number
	cacheReadTokens?: number
	totalCost?: number
}

export interface TokenUsageProperties extends TelemetryProperties {
	ulid: string
	tokensIn: number
	tokensOut: number
	model: string
}

export interface ModeSwitchProperties extends TelemetryProperties {
	ulid: string
	mode: Mode
}

export interface ToolUsageProperties extends TelemetryProperties {
	ulid: string
	tool: string
	modelId: string
	autoApproved: boolean
	success: boolean
}

export interface McpToolCallProperties extends TelemetryProperties {
	ulid: string
	serverName: string
	toolName: string
	status: "started" | "success" | "error"
	errorMessage?: string
	argumentKeys?: string[]
}

export interface CheckpointUsageProperties extends TelemetryProperties {
	ulid: string
	action: "shadow_git_initialized" | "commit_created" | "restored" | "diff_generated"
	durationMs?: number
}

export interface DiffEditFailureProperties extends TelemetryProperties {
	ulid: string
	modelId: string
	errorType?: string
}

export interface OptionSelectedProperties extends TelemetryProperties {
	ulid: string
	qty: number
	mode: Mode
}

export interface GeminiApiPerformanceProperties extends TelemetryProperties {
	ulid: string
	modelId: string
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
}

export interface ProviderApiErrorProperties extends TelemetryProperties {
	ulid: string
	model: string
	errorMessage: string
	provider?: string
	errorStatus?: number
	requestId?: string
	timestamp: string
}

export interface SummarizeTaskProperties extends TelemetryProperties {
	ulid: string
	modelId: string
	currentTokens: number
	maxContextWindow: number
}

export interface SlashCommandUsedProperties extends TelemetryProperties {
	ulid: string
	commandName: string
	commandType: "builtin" | "workflow"
}

export interface ClineRuleToggledProperties extends TelemetryProperties {
	ulid: string
	ruleFileName: string
	enabled: boolean
	isGlobal: boolean
}

export interface AutoCondenseToggleProperties extends TelemetryProperties {
	ulid: string
	enabled: boolean
	modelId: string
}

export interface YoloModeToggleProperties extends TelemetryProperties {
	ulid: string
	enabled: boolean
}

export interface TaskInitializationProperties extends TelemetryProperties {
	ulid: string
	taskId: string
	durationMs: number
	hasCheckpoints: boolean
}

export interface TerminalExecutionProperties extends TelemetryProperties {
	success: boolean
	method: "shell_integration" | "clipboard" | "none"
}

export interface TerminalOutputFailureProperties extends TelemetryProperties {
	reason: string
}

export interface TerminalUserInterventionProperties extends TelemetryProperties {
	action: string
}

export interface TerminalHangProperties extends TelemetryProperties {
	stage: string
}

export interface FocusChainToggleProperties extends TelemetryProperties {
	enabled: boolean
}

export interface FocusChainProgressFirstProperties extends TelemetryProperties {
	ulid: string
	totalItems: number
}

export interface FocusChainProgressUpdateProperties extends TelemetryProperties {
	ulid: string
	totalItems: number
	completedItems: number
	completionPercentage: number
}

export interface FocusChainIncompleteOnCompletionProperties extends TelemetryProperties {
	ulid: string
	totalItems: number
	completedItems: number
	incompleteItems: number
	completionPercentage: number
}

export interface FocusChainListOpenedProperties extends TelemetryProperties {
	ulid: string
}

export interface FocusChainListWrittenProperties extends TelemetryProperties {
	ulid: string
}

/**
 * Event handler for task-related telemetry events
 */
export class TaskEvents extends EventHandlerBase {
	static override readonly prefix = "task"

	/**
	 * Records when a new task/conversation is started
	 */
	static captureTaskCreated(service: TelemetryService, ulid: string, apiProvider?: string): void {
		const properties: TaskCreatedProperties = { ulid, apiProvider }
		TaskEvents.capture(service, "task.created", properties)
	}

	/**
	 * Records when a task/conversation is restarted
	 */
	static captureTaskRestarted(service: TelemetryService, ulid: string, apiProvider?: string): void {
		const properties: TaskCreatedProperties = { ulid, apiProvider }
		TaskEvents.capture(service, "task.restarted", properties)
	}

	/**
	 * Records when cline calls the task completion_result tool
	 */
	static captureTaskCompleted(service: TelemetryService, ulid: string): void {
		const properties: TaskCompletedProperties = { ulid }
		TaskEvents.capture(service, "task.completed", properties)
	}

	/**
	 * Records user feedback on completed tasks
	 */
	static captureTaskFeedback(service: TelemetryService, ulid: string, feedbackType: TaskFeedbackType): void {
		const properties: TaskFeedbackProperties = { ulid, feedbackType }
		TaskEvents.capture(service, "task.feedback", properties)
	}

	/**
	 * Captures that a message was sent
	 */
	static captureConversationTurnEvent(
		service: TelemetryService,
		ulid: string,
		provider: string,
		model: string,
		source: "user" | "assistant",
		tokenUsage: {
			tokensIn?: number
			tokensOut?: number
			cacheWriteTokens?: number
			cacheReadTokens?: number
			totalCost?: number
		} = {},
	): void {
		const properties: ConversationTurnProperties = {
			ulid,
			provider,
			model,
			source,
			timestamp: new Date().toISOString(),
			...tokenUsage,
		}
		TaskEvents.capture(service, "task.conversation_turn", properties)
	}

	/**
	 * Records token usage metrics
	 */
	static captureTokenUsage(service: TelemetryService, ulid: string, tokensIn: number, tokensOut: number, model: string): void {
		const properties: TokenUsageProperties = { ulid, tokensIn, tokensOut, model }
		TaskEvents.capture(service, "task.tokens", properties)
	}

	/**
	 * Records when a task switches between plan and act modes
	 */
	static captureModeSwitch(service: TelemetryService, ulid: string, mode: Mode): void {
		const properties: ModeSwitchProperties = { ulid, mode }
		TaskEvents.capture(service, "task.mode", properties)
	}

	/**
	 * Records when a tool is used during task execution
	 */
	static captureToolUsage(
		service: TelemetryService,
		ulid: string,
		tool: string,
		modelId: string,
		autoApproved: boolean,
		success: boolean,
	): void {
		const properties: ToolUsageProperties = { ulid, tool, modelId, autoApproved, success }
		TaskEvents.capture(service, "task.tool_used", properties)
	}

	/**
	 * Records when an MCP tool is called
	 */
	static captureMcpToolCall(
		service: TelemetryService,
		ulid: string,
		serverName: string,
		toolName: string,
		status: "started" | "success" | "error",
		errorMessage?: string,
		argumentKeys?: string[],
	): void {
		const properties: McpToolCallProperties = { ulid, serverName, toolName, status, errorMessage, argumentKeys }
		TaskEvents.capture(service, "task.mcp_tool_called", properties)
	}

	/**
	 * Records interactions with the git-based checkpoint system
	 */
	static captureCheckpointUsage(
		service: TelemetryService,
		ulid: string,
		action: "shadow_git_initialized" | "commit_created" | "restored" | "diff_generated",
		durationMs?: number,
	): void {
		const properties: CheckpointUsageProperties = { ulid, action, durationMs }
		TaskEvents.capture(service, "task.checkpoint_used", properties)
	}

	/**
	 * Records when a diff edit operation fails
	 */
	static captureDiffEditFailure(service: TelemetryService, ulid: string, modelId: string, errorType?: string): void {
		const properties: DiffEditFailureProperties = { ulid, modelId, errorType }
		TaskEvents.capture(service, "task.diff_edit_failed", properties)
	}

	/**
	 * Records when a user selects an option from AI-generated followup questions
	 */
	static captureOptionSelected(service: TelemetryService, ulid: string, qty: number, mode: Mode): void {
		const properties: OptionSelectedProperties = { ulid, qty, mode }
		TaskEvents.capture(service, "task.option_selected", properties)
	}

	/**
	 * Records when a user types a custom response instead of selecting an option
	 */
	static captureOptionsIgnored(service: TelemetryService, ulid: string, qty: number, mode: Mode): void {
		const properties: OptionSelectedProperties = { ulid, qty, mode }
		TaskEvents.capture(service, "task.options_ignored", properties)
	}

	/**
	 * Captures Gemini API performance metrics
	 */
	static captureGeminiApiPerformance(
		service: TelemetryService,
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
	): void {
		const properties: GeminiApiPerformanceProperties = { ulid, modelId, ...data }
		TaskEvents.capture(service, "task.gemini_api_performance", properties)
	}

	/**
	 * Records when an API provider returns an error
	 */
	static captureProviderApiError(
		service: TelemetryService,
		args: {
			ulid: string
			model: string
			errorMessage: string
			provider?: string
			errorStatus?: number
			requestId?: string
		},
	): void {
		const properties: ProviderApiErrorProperties = {
			...args,
			errorMessage: args.errorMessage.substring(0, 500),
			timestamp: new Date().toISOString(),
		}
		TaskEvents.capture(service, "task.provider_api_error", properties)
	}

	/**
	 * Records when context summarization is triggered
	 */
	static captureSummarizeTask(
		service: TelemetryService,
		ulid: string,
		modelId: string,
		currentTokens: number,
		maxContextWindow: number,
	): void {
		const properties: SummarizeTaskProperties = { ulid, modelId, currentTokens, maxContextWindow }
		TaskEvents.capture(service, "task.summarize_task", properties)
	}

	/**
	 * Records when slash commands or workflows are activated
	 */
	static captureSlashCommandUsed(
		service: TelemetryService,
		ulid: string,
		commandName: string,
		commandType: "builtin" | "workflow",
	): void {
		const properties: SlashCommandUsedProperties = { ulid, commandName, commandType }
		TaskEvents.capture(service, "task.slash_command_used", properties)
	}

	/**
	 * Records when individual Cline rules are toggled on/off
	 */
	static captureClineRuleToggled(
		service: TelemetryService,
		ulid: string,
		ruleFileName: string,
		enabled: boolean,
		isGlobal: boolean,
	): void {
		const sanitizedFileName = ruleFileName.split("/").pop() || ruleFileName.split("\\").pop() || ruleFileName
		const properties: ClineRuleToggledProperties = { ulid, ruleFileName: sanitizedFileName, enabled, isGlobal }
		TaskEvents.capture(service, "task.rule_toggled", properties)
	}

	/**
	 * Records when auto condense is enabled/disabled
	 */
	static captureAutoCondenseToggle(service: TelemetryService, ulid: string, enabled: boolean, modelId: string): void {
		const properties: AutoCondenseToggleProperties = { ulid, enabled, modelId }
		TaskEvents.capture(service, "task.auto_condense_toggled", properties)
	}

	/**
	 * Records when yolo mode is enabled/disabled
	 */
	static captureYoloModeToggle(service: TelemetryService, ulid: string, enabled: boolean): void {
		const properties: YoloModeToggleProperties = { ulid, enabled }
		TaskEvents.capture(service, "task.yolo_mode_toggled", properties)
	}

	/**
	 * Records task initialization timing
	 */
	static captureTaskInitialization(
		service: TelemetryService,
		ulid: string,
		taskId: string,
		durationMs: number,
		hasCheckpoints: boolean,
	): void {
		const properties: TaskInitializationProperties = { ulid, taskId, durationMs, hasCheckpoints }
		TaskEvents.capture(service, "task.initialization", properties)
	}

	/**
	 * Records terminal command execution outcomes
	 */
	static captureTerminalExecution(
		service: TelemetryService,
		success: boolean,
		method: "shell_integration" | "clipboard" | "none",
	): void {
		const properties: TerminalExecutionProperties = { success, method }
		TaskEvents.capture(service, "task.terminal_execution", properties)
	}

	/**
	 * Records when terminal output capture fails
	 */
	static captureTerminalOutputFailure(service: TelemetryService, reason: string): void {
		const properties: TerminalOutputFailureProperties = { reason }
		TaskEvents.capture(service, "task.terminal_output_failure", properties)
	}

	/**
	 * Records when user has to intervene with terminal execution
	 */
	static captureTerminalUserIntervention(service: TelemetryService, action: string): void {
		const properties: TerminalUserInterventionProperties = { action }
		TaskEvents.capture(service, "task.terminal_user_intervention", properties)
	}

	/**
	 * Records when terminal execution hangs
	 */
	static captureTerminalHang(service: TelemetryService, stage: string): void {
		const properties: TerminalHangProperties = { stage }
		TaskEvents.capture(service, "task.terminal_hang", properties)
	}

	/**
	 * Records when focus chain is enabled/disabled
	 */
	static captureFocusChainToggle(service: TelemetryService, enabled: boolean): void {
		const properties: FocusChainToggleProperties = { enabled }
		const event = enabled ? "task.focus_chain_enabled" : "task.focus_chain_disabled"
		TaskEvents.capture(service, event, properties)
	}

	/**
	 * Records when a task progress list is returned for the first time
	 */
	static captureFocusChainProgressFirst(service: TelemetryService, ulid: string, totalItems: number): void {
		const properties: FocusChainProgressFirstProperties = { ulid, totalItems }
		TaskEvents.capture(service, "task.focus_chain_progress_first", properties)
	}

	/**
	 * Records when a task progress list is updated
	 */
	static captureFocusChainProgressUpdate(
		service: TelemetryService,
		ulid: string,
		totalItems: number,
		completedItems: number,
	): void {
		const properties: FocusChainProgressUpdateProperties = {
			ulid,
			totalItems,
			completedItems,
			completionPercentage: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
		}
		TaskEvents.capture(service, "task.focus_chain_progress_update", properties)
	}

	/**
	 * Records when a task ends but the task progress list is not complete
	 */
	static captureFocusChainIncompleteOnCompletion(
		service: TelemetryService,
		ulid: string,
		totalItems: number,
		completedItems: number,
		incompleteItems: number,
	): void {
		const properties: FocusChainIncompleteOnCompletionProperties = {
			ulid,
			totalItems,
			completedItems,
			incompleteItems,
			completionPercentage: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
		}
		TaskEvents.capture(service, "task.focus_chain_incomplete_on_completion", properties)
	}

	/**
	 * Records when users click to open the focus chain markdown file
	 */
	static captureFocusChainListOpened(service: TelemetryService, ulid: string): void {
		const properties: FocusChainListOpenedProperties = { ulid }
		TaskEvents.capture(service, "task.focus_chain_list_opened", properties)
	}

	/**
	 * Records when users save and write to the focus chain markdown file
	 */
	static captureFocusChainListWritten(service: TelemetryService, ulid: string): void {
		const properties: FocusChainListWrittenProperties = { ulid }
		TaskEvents.capture(service, "task.focus_chain_list_written", properties)
	}
}

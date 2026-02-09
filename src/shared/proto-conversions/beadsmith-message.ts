import { BeadsmithAsk as AppBeadsmithAsk, BeadsmithMessage as AppBeadsmithMessage, BeadsmithSay as AppBeadsmithSay } from "@shared/ExtensionMessage"
import { BeadsmithAsk, BeadsmithMessageType, BeadsmithSay, BeadsmithMessage as ProtoBeadsmithMessage } from "@shared/proto/beadsmith/ui"

// Helper function to convert BeadsmithAsk string to enum
function convertBeadsmithAskToProtoEnum(ask: AppBeadsmithAsk | undefined): BeadsmithAsk | undefined {
	if (!ask) {
		return undefined
	}

	const mapping: Record<AppBeadsmithAsk, BeadsmithAsk> = {
		followup: BeadsmithAsk.FOLLOWUP,
		plan_mode_respond: BeadsmithAsk.PLAN_MODE_RESPOND,
		act_mode_respond: BeadsmithAsk.ACT_MODE_RESPOND,
		command: BeadsmithAsk.COMMAND,
		command_output: BeadsmithAsk.COMMAND_OUTPUT,
		completion_result: BeadsmithAsk.COMPLETION_RESULT,
		tool: BeadsmithAsk.TOOL,
		api_req_failed: BeadsmithAsk.API_REQ_FAILED,
		resume_task: BeadsmithAsk.RESUME_TASK,
		resume_completed_task: BeadsmithAsk.RESUME_COMPLETED_TASK,
		mistake_limit_reached: BeadsmithAsk.MISTAKE_LIMIT_REACHED,
		browser_action_launch: BeadsmithAsk.BROWSER_ACTION_LAUNCH,
		use_mcp_server: BeadsmithAsk.USE_MCP_SERVER,
		new_task: BeadsmithAsk.NEW_TASK,
		condense: BeadsmithAsk.CONDENSE,
		summarize_task: BeadsmithAsk.SUMMARIZE_TASK,
		report_bug: BeadsmithAsk.REPORT_BUG,
		bead_review: BeadsmithAsk.BEAD_REVIEW,
	}

	const result = mapping[ask]
	if (result === undefined) {
	}
	return result
}

// Helper function to convert BeadsmithAsk enum to string
function convertProtoEnumToBeadsmithAsk(ask: BeadsmithAsk): AppBeadsmithAsk | undefined {
	if (ask === BeadsmithAsk.UNRECOGNIZED) {
		return undefined
	}

	const mapping: Record<Exclude<BeadsmithAsk, BeadsmithAsk.UNRECOGNIZED>, AppBeadsmithAsk> = {
		[BeadsmithAsk.FOLLOWUP]: "followup",
		[BeadsmithAsk.PLAN_MODE_RESPOND]: "plan_mode_respond",
		[BeadsmithAsk.ACT_MODE_RESPOND]: "act_mode_respond",
		[BeadsmithAsk.COMMAND]: "command",
		[BeadsmithAsk.COMMAND_OUTPUT]: "command_output",
		[BeadsmithAsk.COMPLETION_RESULT]: "completion_result",
		[BeadsmithAsk.TOOL]: "tool",
		[BeadsmithAsk.API_REQ_FAILED]: "api_req_failed",
		[BeadsmithAsk.RESUME_TASK]: "resume_task",
		[BeadsmithAsk.RESUME_COMPLETED_TASK]: "resume_completed_task",
		[BeadsmithAsk.MISTAKE_LIMIT_REACHED]: "mistake_limit_reached",
		[BeadsmithAsk.BROWSER_ACTION_LAUNCH]: "browser_action_launch",
		[BeadsmithAsk.USE_MCP_SERVER]: "use_mcp_server",
		[BeadsmithAsk.NEW_TASK]: "new_task",
		[BeadsmithAsk.CONDENSE]: "condense",
		[BeadsmithAsk.SUMMARIZE_TASK]: "summarize_task",
		[BeadsmithAsk.REPORT_BUG]: "report_bug",
		[BeadsmithAsk.BEAD_REVIEW]: "bead_review",
	}

	return mapping[ask]
}

// Helper function to convert BeadsmithSay string to enum
function convertBeadsmithSayToProtoEnum(say: AppBeadsmithSay | undefined): BeadsmithSay | undefined {
	if (!say) {
		return undefined
	}

	const mapping: Record<AppBeadsmithSay, BeadsmithSay> = {
		task: BeadsmithSay.TASK,
		error: BeadsmithSay.ERROR,
		api_req_started: BeadsmithSay.API_REQ_STARTED,
		api_req_finished: BeadsmithSay.API_REQ_FINISHED,
		text: BeadsmithSay.TEXT,
		reasoning: BeadsmithSay.REASONING,
		completion_result: BeadsmithSay.COMPLETION_RESULT_SAY,
		user_feedback: BeadsmithSay.USER_FEEDBACK,
		user_feedback_diff: BeadsmithSay.USER_FEEDBACK_DIFF,
		api_req_retried: BeadsmithSay.API_REQ_RETRIED,
		command: BeadsmithSay.COMMAND_SAY,
		command_output: BeadsmithSay.COMMAND_OUTPUT_SAY,
		tool: BeadsmithSay.TOOL_SAY,
		shell_integration_warning: BeadsmithSay.SHELL_INTEGRATION_WARNING,
		shell_integration_warning_with_suggestion: BeadsmithSay.SHELL_INTEGRATION_WARNING,
		browser_action_launch: BeadsmithSay.BROWSER_ACTION_LAUNCH_SAY,
		browser_action: BeadsmithSay.BROWSER_ACTION,
		browser_action_result: BeadsmithSay.BROWSER_ACTION_RESULT,
		mcp_server_request_started: BeadsmithSay.MCP_SERVER_REQUEST_STARTED,
		mcp_server_response: BeadsmithSay.MCP_SERVER_RESPONSE,
		mcp_notification: BeadsmithSay.MCP_NOTIFICATION,
		use_mcp_server: BeadsmithSay.USE_MCP_SERVER_SAY,
		diff_error: BeadsmithSay.DIFF_ERROR,
		deleted_api_reqs: BeadsmithSay.DELETED_API_REQS,
		beadsmithignore_error: BeadsmithSay.BEADSMITHIGNORE_ERROR,
		command_permission_denied: BeadsmithSay.COMMAND_PERMISSION_DENIED,
		checkpoint_created: BeadsmithSay.CHECKPOINT_CREATED,
		load_mcp_documentation: BeadsmithSay.LOAD_MCP_DOCUMENTATION,
		info: BeadsmithSay.INFO,
		task_progress: BeadsmithSay.TASK_PROGRESS,
		error_retry: BeadsmithSay.ERROR_RETRY,
		hook_status: BeadsmithSay.HOOK_STATUS,
		hook_output_stream: BeadsmithSay.HOOK_OUTPUT_STREAM,
		conditional_rules_applied: BeadsmithSay.CONDITIONAL_RULES_APPLIED,
		generate_explanation: BeadsmithSay.GENERATE_EXPLANATION,
		bead_started: BeadsmithSay.BEAD_STARTED,
		bead_completed: BeadsmithSay.BEAD_COMPLETED,
		bead_failed: BeadsmithSay.BEAD_FAILED,
	}

	const result = mapping[say]

	return result
}

// Helper function to convert BeadsmithSay enum to string
function convertProtoEnumToBeadsmithSay(say: BeadsmithSay): AppBeadsmithSay | undefined {
	if (say === BeadsmithSay.UNRECOGNIZED) {
		return undefined
	}

	const mapping: Record<Exclude<BeadsmithSay, BeadsmithSay.UNRECOGNIZED>, AppBeadsmithSay> = {
		[BeadsmithSay.TASK]: "task",
		[BeadsmithSay.ERROR]: "error",
		[BeadsmithSay.API_REQ_STARTED]: "api_req_started",
		[BeadsmithSay.API_REQ_FINISHED]: "api_req_finished",
		[BeadsmithSay.TEXT]: "text",
		[BeadsmithSay.REASONING]: "reasoning",
		[BeadsmithSay.COMPLETION_RESULT_SAY]: "completion_result",
		[BeadsmithSay.USER_FEEDBACK]: "user_feedback",
		[BeadsmithSay.USER_FEEDBACK_DIFF]: "user_feedback_diff",
		[BeadsmithSay.API_REQ_RETRIED]: "api_req_retried",
		[BeadsmithSay.COMMAND_SAY]: "command",
		[BeadsmithSay.COMMAND_OUTPUT_SAY]: "command_output",
		[BeadsmithSay.TOOL_SAY]: "tool",
		[BeadsmithSay.SHELL_INTEGRATION_WARNING]: "shell_integration_warning",
		[BeadsmithSay.BROWSER_ACTION_LAUNCH_SAY]: "browser_action_launch",
		[BeadsmithSay.BROWSER_ACTION]: "browser_action",
		[BeadsmithSay.BROWSER_ACTION_RESULT]: "browser_action_result",
		[BeadsmithSay.MCP_SERVER_REQUEST_STARTED]: "mcp_server_request_started",
		[BeadsmithSay.MCP_SERVER_RESPONSE]: "mcp_server_response",
		[BeadsmithSay.MCP_NOTIFICATION]: "mcp_notification",
		[BeadsmithSay.USE_MCP_SERVER_SAY]: "use_mcp_server",
		[BeadsmithSay.DIFF_ERROR]: "diff_error",
		[BeadsmithSay.DELETED_API_REQS]: "deleted_api_reqs",
		[BeadsmithSay.BEADSMITHIGNORE_ERROR]: "beadsmithignore_error",
		[BeadsmithSay.COMMAND_PERMISSION_DENIED]: "command_permission_denied",
		[BeadsmithSay.CHECKPOINT_CREATED]: "checkpoint_created",
		[BeadsmithSay.LOAD_MCP_DOCUMENTATION]: "load_mcp_documentation",
		[BeadsmithSay.INFO]: "info",
		[BeadsmithSay.TASK_PROGRESS]: "task_progress",
		[BeadsmithSay.ERROR_RETRY]: "error_retry",
		[BeadsmithSay.GENERATE_EXPLANATION]: "generate_explanation",
		[BeadsmithSay.HOOK_STATUS]: "hook_status",
		[BeadsmithSay.HOOK_OUTPUT_STREAM]: "hook_output_stream",
		[BeadsmithSay.CONDITIONAL_RULES_APPLIED]: "conditional_rules_applied",
		[BeadsmithSay.BEAD_STARTED]: "bead_started",
		[BeadsmithSay.BEAD_COMPLETED]: "bead_completed",
		[BeadsmithSay.BEAD_FAILED]: "bead_failed",
	}

	return mapping[say]
}

/**
 * Convert application BeadsmithMessage to proto BeadsmithMessage
 */
export function convertBeadsmithMessageToProto(message: AppBeadsmithMessage): ProtoBeadsmithMessage {
	// For sending messages, we need to provide values for required proto fields
	const askEnum = message.ask ? convertBeadsmithAskToProtoEnum(message.ask) : undefined
	const sayEnum = message.say ? convertBeadsmithSayToProtoEnum(message.say) : undefined

	// Determine appropriate enum values based on message type
	let finalAskEnum: BeadsmithAsk = BeadsmithAsk.FOLLOWUP // Proto default
	let finalSayEnum: BeadsmithSay = BeadsmithSay.TEXT // Proto default

	if (message.type === "ask") {
		finalAskEnum = askEnum ?? BeadsmithAsk.FOLLOWUP // Use FOLLOWUP as default for ask messages
	} else if (message.type === "say") {
		finalSayEnum = sayEnum ?? BeadsmithSay.TEXT // Use TEXT as default for say messages
	}

	const protoMessage: ProtoBeadsmithMessage = {
		ts: message.ts,
		type: message.type === "ask" ? BeadsmithMessageType.ASK : BeadsmithMessageType.SAY,
		ask: finalAskEnum,
		say: finalSayEnum,
		text: message.text ?? "",
		reasoning: message.reasoning ?? "",
		images: message.images ?? [],
		files: message.files ?? [],
		partial: message.partial ?? false,
		lastCheckpointHash: message.lastCheckpointHash ?? "",
		isCheckpointCheckedOut: message.isCheckpointCheckedOut ?? false,
		isOperationOutsideWorkspace: message.isOperationOutsideWorkspace ?? false,
		conversationHistoryIndex: message.conversationHistoryIndex ?? 0,
		conversationHistoryDeletedRange: message.conversationHistoryDeletedRange
			? {
					startIndex: message.conversationHistoryDeletedRange[0],
					endIndex: message.conversationHistoryDeletedRange[1],
				}
			: undefined,
		// Additional optional fields for specific ask/say types
		sayTool: undefined,
		sayBrowserAction: undefined,
		browserActionResult: undefined,
		askUseMcpServer: undefined,
		planModeResponse: undefined,
		askQuestion: undefined,
		askNewTask: undefined,
		apiReqInfo: undefined,
		modelInfo: message.modelInfo ?? undefined,
		// Bead fields
		askBeadReview: undefined,
		sayBeadStarted: undefined,
		sayBeadCompleted: undefined,
		sayBeadFailed: undefined,
	}

	return protoMessage
}

/**
 * Convert proto BeadsmithMessage to application BeadsmithMessage
 */
export function convertProtoToBeadsmithMessage(protoMessage: ProtoBeadsmithMessage): AppBeadsmithMessage {
	const message: AppBeadsmithMessage = {
		ts: protoMessage.ts,
		type: protoMessage.type === BeadsmithMessageType.ASK ? "ask" : "say",
	}

	// Convert ask enum to string
	if (protoMessage.type === BeadsmithMessageType.ASK) {
		const ask = convertProtoEnumToBeadsmithAsk(protoMessage.ask)
		if (ask !== undefined) {
			message.ask = ask
		}
	}

	// Convert say enum to string
	if (protoMessage.type === BeadsmithMessageType.SAY) {
		const say = convertProtoEnumToBeadsmithSay(protoMessage.say)
		if (say !== undefined) {
			message.say = say
		}
	}

	// Convert other fields - preserve empty strings as they may be intentional
	if (protoMessage.text !== "") {
		message.text = protoMessage.text
	}
	if (protoMessage.reasoning !== "") {
		message.reasoning = protoMessage.reasoning
	}
	if (protoMessage.images.length > 0) {
		message.images = protoMessage.images
	}
	if (protoMessage.files.length > 0) {
		message.files = protoMessage.files
	}
	if (protoMessage.partial) {
		message.partial = protoMessage.partial
	}
	if (protoMessage.lastCheckpointHash !== "") {
		message.lastCheckpointHash = protoMessage.lastCheckpointHash
	}
	if (protoMessage.isCheckpointCheckedOut) {
		message.isCheckpointCheckedOut = protoMessage.isCheckpointCheckedOut
	}
	if (protoMessage.isOperationOutsideWorkspace) {
		message.isOperationOutsideWorkspace = protoMessage.isOperationOutsideWorkspace
	}
	if (protoMessage.conversationHistoryIndex !== 0) {
		message.conversationHistoryIndex = protoMessage.conversationHistoryIndex
	}

	// Convert conversationHistoryDeletedRange from object to tuple
	if (protoMessage.conversationHistoryDeletedRange) {
		message.conversationHistoryDeletedRange = [
			protoMessage.conversationHistoryDeletedRange.startIndex,
			protoMessage.conversationHistoryDeletedRange.endIndex,
		]
	}

	return message
}

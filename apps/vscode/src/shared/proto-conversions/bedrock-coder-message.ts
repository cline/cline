import {
	BedrockCoderAsk as AppBedrockCoderAsk,
	BedrockCoderMessage as AppBedrockCoderMessage,
	BedrockCoderSay as AppBedrockCoderSay,
} from "@shared/ExtensionMessage"
import {
	BedrockCoderAsk,
	BedrockCoderMessageType,
	BedrockCoderSay,
	BedrockCoderMessage as ProtoBedrockCoderMessage,
} from "@shared/proto/bedrock_coder/ui"

// Helper function to convert BedrockCoderAsk string to enum
function convertBedrockCoderAskToProtoEnum(ask: AppBedrockCoderAsk | undefined): BedrockCoderAsk | undefined {
	if (!ask) {
		return undefined
	}

	const mapping: Record<AppBedrockCoderAsk, BedrockCoderAsk> = {
		followup: BedrockCoderAsk.FOLLOWUP,
		plan_mode_respond: BedrockCoderAsk.PLAN_MODE_RESPOND,
		act_mode_respond: BedrockCoderAsk.ACT_MODE_RESPOND,
		command: BedrockCoderAsk.COMMAND,
		command_output: BedrockCoderAsk.COMMAND_OUTPUT,
		completion_result: BedrockCoderAsk.COMPLETION_RESULT,
		tool: BedrockCoderAsk.TOOL,
		api_req_failed: BedrockCoderAsk.API_REQ_FAILED,
		resume_task: BedrockCoderAsk.RESUME_TASK,
		resume_completed_task: BedrockCoderAsk.RESUME_COMPLETED_TASK,
		mistake_limit_reached: BedrockCoderAsk.MISTAKE_LIMIT_REACHED,
		browser_action_launch: BedrockCoderAsk.BROWSER_ACTION_LAUNCH,
		use_mcp_server: BedrockCoderAsk.USE_MCP_SERVER,
		new_task: BedrockCoderAsk.NEW_TASK,
		condense: BedrockCoderAsk.CONDENSE,
		summarize_task: BedrockCoderAsk.SUMMARIZE_TASK,
		report_bug: BedrockCoderAsk.REPORT_BUG,
		use_subagents: BedrockCoderAsk.USE_SUBAGENTS,
	}

	const result = mapping[ask]
	if (result === undefined) {
	}
	return result
}

// Helper function to convert BedrockCoderAsk enum to string
function convertProtoEnumToBedrockCoderAsk(ask: BedrockCoderAsk): AppBedrockCoderAsk | undefined {
	if (ask === BedrockCoderAsk.UNRECOGNIZED) {
		return undefined
	}

	const mapping: Record<Exclude<BedrockCoderAsk, BedrockCoderAsk.UNRECOGNIZED>, AppBedrockCoderAsk> = {
		[BedrockCoderAsk.FOLLOWUP]: "followup",
		[BedrockCoderAsk.PLAN_MODE_RESPOND]: "plan_mode_respond",
		[BedrockCoderAsk.ACT_MODE_RESPOND]: "act_mode_respond",
		[BedrockCoderAsk.COMMAND]: "command",
		[BedrockCoderAsk.COMMAND_OUTPUT]: "command_output",
		[BedrockCoderAsk.COMPLETION_RESULT]: "completion_result",
		[BedrockCoderAsk.TOOL]: "tool",
		[BedrockCoderAsk.API_REQ_FAILED]: "api_req_failed",
		[BedrockCoderAsk.RESUME_TASK]: "resume_task",
		[BedrockCoderAsk.RESUME_COMPLETED_TASK]: "resume_completed_task",
		[BedrockCoderAsk.MISTAKE_LIMIT_REACHED]: "mistake_limit_reached",
		[BedrockCoderAsk.BROWSER_ACTION_LAUNCH]: "browser_action_launch",
		[BedrockCoderAsk.USE_MCP_SERVER]: "use_mcp_server",
		[BedrockCoderAsk.NEW_TASK]: "new_task",
		[BedrockCoderAsk.CONDENSE]: "condense",
		[BedrockCoderAsk.SUMMARIZE_TASK]: "summarize_task",
		[BedrockCoderAsk.REPORT_BUG]: "report_bug",
		[BedrockCoderAsk.USE_SUBAGENTS]: "use_subagents",
	}

	return mapping[ask]
}

// Helper function to convert BedrockCoderSay string to enum
function convertBedrockCoderSayToProtoEnum(say: AppBedrockCoderSay | undefined): BedrockCoderSay | undefined {
	if (!say) {
		return undefined
	}

	const mapping: Record<AppBedrockCoderSay, BedrockCoderSay> = {
		task: BedrockCoderSay.TASK,
		error: BedrockCoderSay.ERROR,
		api_req_started: BedrockCoderSay.API_REQ_STARTED,
		api_req_finished: BedrockCoderSay.API_REQ_FINISHED,
		text: BedrockCoderSay.TEXT,
		reasoning: BedrockCoderSay.REASONING,
		completion_result: BedrockCoderSay.COMPLETION_RESULT_SAY,
		user_feedback: BedrockCoderSay.USER_FEEDBACK,
		user_feedback_diff: BedrockCoderSay.USER_FEEDBACK_DIFF,
		api_req_retried: BedrockCoderSay.API_REQ_RETRIED,
		command: BedrockCoderSay.COMMAND_SAY,
		command_output: BedrockCoderSay.COMMAND_OUTPUT_SAY,
		tool: BedrockCoderSay.TOOL_SAY,
		shell_integration_warning: BedrockCoderSay.SHELL_INTEGRATION_WARNING,
		shell_integration_warning_with_suggestion: BedrockCoderSay.SHELL_INTEGRATION_WARNING,
		browser_action_launch: BedrockCoderSay.BROWSER_ACTION_LAUNCH_SAY,
		browser_action: BedrockCoderSay.BROWSER_ACTION,
		browser_action_result: BedrockCoderSay.BROWSER_ACTION_RESULT,
		mcp_server_request_started: BedrockCoderSay.MCP_SERVER_REQUEST_STARTED,
		mcp_server_response: BedrockCoderSay.MCP_SERVER_RESPONSE,
		mcp_notification: BedrockCoderSay.MCP_NOTIFICATION,
		use_mcp_server: BedrockCoderSay.USE_MCP_SERVER_SAY,
		diff_error: BedrockCoderSay.DIFF_ERROR,
		deleted_api_reqs: BedrockCoderSay.DELETED_API_REQS,
		bedrockCoderignore_error: BedrockCoderSay.BEDROCK_CODERIGNORE_ERROR,
		command_permission_denied: BedrockCoderSay.COMMAND_PERMISSION_DENIED,
		checkpoint_created: BedrockCoderSay.CHECKPOINT_CREATED,
		load_mcp_documentation: BedrockCoderSay.LOAD_MCP_DOCUMENTATION,
		info: BedrockCoderSay.INFO,
		task_progress: BedrockCoderSay.TASK_PROGRESS,
		error_retry: BedrockCoderSay.ERROR_RETRY,
		hook_status: BedrockCoderSay.HOOK_STATUS,
		hook_output_stream: BedrockCoderSay.HOOK_OUTPUT_STREAM,
		conditional_rules_applied: BedrockCoderSay.CONDITIONAL_RULES_APPLIED,
		subagent: BedrockCoderSay.SUBAGENT_STATUS,
		use_subagents: BedrockCoderSay.USE_SUBAGENTS_SAY,
		subagent_usage: BedrockCoderSay.SUBAGENT_USAGE,
		compaction: BedrockCoderSay.COMPACTION,
	}

	const result = mapping[say]

	return result
}

// Helper function to convert BedrockCoderSay enum to string
function convertProtoEnumToBedrockCoderSay(say: BedrockCoderSay): AppBedrockCoderSay | undefined {
	if (say === BedrockCoderSay.UNRECOGNIZED) {
		return undefined
	}

	const mapping: Record<Exclude<BedrockCoderSay, BedrockCoderSay.UNRECOGNIZED>, AppBedrockCoderSay> = {
		[BedrockCoderSay.TASK]: "task",
		[BedrockCoderSay.ERROR]: "error",
		[BedrockCoderSay.API_REQ_STARTED]: "api_req_started",
		[BedrockCoderSay.API_REQ_FINISHED]: "api_req_finished",
		[BedrockCoderSay.TEXT]: "text",
		[BedrockCoderSay.REASONING]: "reasoning",
		[BedrockCoderSay.COMPLETION_RESULT_SAY]: "completion_result",
		[BedrockCoderSay.USER_FEEDBACK]: "user_feedback",
		[BedrockCoderSay.USER_FEEDBACK_DIFF]: "user_feedback_diff",
		[BedrockCoderSay.API_REQ_RETRIED]: "api_req_retried",
		[BedrockCoderSay.COMMAND_SAY]: "command",
		[BedrockCoderSay.COMMAND_OUTPUT_SAY]: "command_output",
		[BedrockCoderSay.TOOL_SAY]: "tool",
		[BedrockCoderSay.SHELL_INTEGRATION_WARNING]: "shell_integration_warning",
		[BedrockCoderSay.BROWSER_ACTION_LAUNCH_SAY]: "browser_action_launch",
		[BedrockCoderSay.BROWSER_ACTION]: "browser_action",
		[BedrockCoderSay.BROWSER_ACTION_RESULT]: "browser_action_result",
		[BedrockCoderSay.MCP_SERVER_REQUEST_STARTED]: "mcp_server_request_started",
		[BedrockCoderSay.MCP_SERVER_RESPONSE]: "mcp_server_response",
		[BedrockCoderSay.MCP_NOTIFICATION]: "mcp_notification",
		[BedrockCoderSay.USE_MCP_SERVER_SAY]: "use_mcp_server",
		[BedrockCoderSay.DIFF_ERROR]: "diff_error",
		[BedrockCoderSay.DELETED_API_REQS]: "deleted_api_reqs",
		[BedrockCoderSay.BEDROCK_CODERIGNORE_ERROR]: "bedrockCoderignore_error",
		[BedrockCoderSay.COMMAND_PERMISSION_DENIED]: "command_permission_denied",
		[BedrockCoderSay.CHECKPOINT_CREATED]: "checkpoint_created",
		[BedrockCoderSay.LOAD_MCP_DOCUMENTATION]: "load_mcp_documentation",
		[BedrockCoderSay.INFO]: "info",
		[BedrockCoderSay.TASK_PROGRESS]: "task_progress",
		[BedrockCoderSay.ERROR_RETRY]: "error_retry",
		[BedrockCoderSay.HOOK_STATUS]: "hook_status",
		[BedrockCoderSay.HOOK_OUTPUT_STREAM]: "hook_output_stream",
		[BedrockCoderSay.CONDITIONAL_RULES_APPLIED]: "conditional_rules_applied",
		[BedrockCoderSay.SUBAGENT_STATUS]: "subagent",
		[BedrockCoderSay.USE_SUBAGENTS_SAY]: "use_subagents",
		[BedrockCoderSay.SUBAGENT_USAGE]: "subagent_usage",
		[BedrockCoderSay.COMPACTION]: "compaction",
	}

	return mapping[say]
}

/**
 * Convert application BedrockCoderMessage to proto BedrockCoderMessage
 */
export function convertBedrockCoderMessageToProto(message: AppBedrockCoderMessage): ProtoBedrockCoderMessage {
	// For sending messages, we need to provide values for required proto fields
	const askEnum = message.ask ? convertBedrockCoderAskToProtoEnum(message.ask) : undefined
	const sayEnum = message.say ? convertBedrockCoderSayToProtoEnum(message.say) : undefined

	// Determine appropriate enum values based on message type
	let finalAskEnum: BedrockCoderAsk = BedrockCoderAsk.FOLLOWUP // Proto default
	let finalSayEnum: BedrockCoderSay = BedrockCoderSay.TEXT // Proto default

	if (message.type === "ask") {
		finalAskEnum = askEnum ?? BedrockCoderAsk.FOLLOWUP // Use FOLLOWUP as default for ask messages
	} else if (message.type === "say") {
		finalSayEnum = sayEnum ?? BedrockCoderSay.TEXT // Use TEXT as default for say messages
	}

	const protoMessage: ProtoBedrockCoderMessage = {
		ts: message.ts,
		type: message.type === "ask" ? BedrockCoderMessageType.ASK : BedrockCoderMessageType.SAY,
		ask: finalAskEnum,
		say: finalSayEnum,
		text: message.text ?? "",
		reasoning: message.reasoning ?? "",
		images: message.images ?? [],
		files: message.files ?? [],
		partial: message.partial ?? false,
		// Convergent-replica fields (default 0 = unstamped, e.g. classic/legacy path).
		seq: message.seq ?? 0,
		epoch: message.epoch ?? 0,
		toolResultId: message.toolResultId ?? "",
		toolResultPreview: message.toolResultPreview ?? "",
		toolResultTruncated: message.toolResultTruncated ?? false,
		toolResultIsError: message.toolResultIsError ?? false,
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
	}

	return protoMessage
}

/**
 * Convert proto BedrockCoderMessage to application BedrockCoderMessage
 */
export function convertProtoToBedrockCoderMessage(protoMessage: ProtoBedrockCoderMessage): AppBedrockCoderMessage {
	const message: AppBedrockCoderMessage = {
		ts: protoMessage.ts,
		type: protoMessage.type === BedrockCoderMessageType.ASK ? "ask" : "say",
	}

	// Convert ask enum to string
	if (protoMessage.type === BedrockCoderMessageType.ASK) {
		const ask = convertProtoEnumToBedrockCoderAsk(protoMessage.ask)
		if (ask !== undefined) {
			message.ask = ask
		}
	}

	// Convert say enum to string
	if (protoMessage.type === BedrockCoderMessageType.SAY) {
		const say = convertProtoEnumToBedrockCoderSay(protoMessage.say)
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

	// Convergent-replica fields. 0 means unstamped (classic/legacy path) — leave undefined so
	// the webview reducer treats such messages as always-applicable rather than epoch 0.
	if (protoMessage.seq && protoMessage.seq !== 0) {
		message.seq = protoMessage.seq
	}
	if (protoMessage.epoch && protoMessage.epoch !== 0) {
		message.epoch = protoMessage.epoch
	}
	if (protoMessage.toolResultId) {
		message.toolResultId = protoMessage.toolResultId
		message.toolResultPreview = protoMessage.toolResultPreview
		message.toolResultTruncated = protoMessage.toolResultTruncated
		message.toolResultIsError = protoMessage.toolResultIsError
	}

	return message
}

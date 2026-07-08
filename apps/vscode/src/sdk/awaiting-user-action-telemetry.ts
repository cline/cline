import type { ClineAsk } from "@shared/ExtensionMessage"
import type { TaskAwaitingUserActionType } from "@/services/telemetry/TelemetryService"

export interface SdkAwaitingUserActionTelemetry {
	sessionId?: string
	awaitingType: TaskAwaitingUserActionType
	askType?: ClineAsk
}

export function awaitingUserActionTypeForAsk(askType: ClineAsk): TaskAwaitingUserActionType {
	switch (askType) {
		case "followup":
			return "followup"
		case "plan_mode_respond":
			return "plan_response"
		case "act_mode_respond":
			return "act_response"
		case "tool":
			return "tool_approval"
		case "command":
		case "command_output":
			return "command_approval"
		case "use_mcp_server":
			return "mcp_approval"
		case "use_subagents":
			return "subagent_approval"
		case "browser_action_launch":
			return "browser_action"
		case "api_req_failed":
			return "api_retry"
		case "mistake_limit_reached":
			return "mistake_limit"
		case "condense":
			return "condense"
		case "summarize_task":
			return "summarize_task"
		case "completion_result":
		case "resume_completed_task":
			return "completion_result"
		default:
			return "unknown"
	}
}

import { ClineDefaultTool } from "@shared/tools"
export type AssistantMessageContent = TextContent | ToolUse

export { parseAssistantMessageV2 } from "./parse-assistant-message"

export interface TextContent {
	type: "text"
	content: string
	partial: boolean
}

export const toolParamNames = [
	"command",
	"requires_approval",
	"path",
	"content",
	"diff",
	"regex",
	"file_pattern",
	"recursive",
	"action",
	"url",
	"coordinate",
	"text",
	"server_name",
	"tool_name",
	"arguments",
	"uri",
	"question",
	"options",
	"response",
	"result",
	"context",
	"title",
	"what_happened",
	"steps_to_reproduce",
	"api_request_output",
	"additional_context",
	"needs_more_exploration",
	"task_progress",
] as const

export type ToolParamName = (typeof toolParamNames)[number]

export interface ToolUse {
	type: "tool_use"
	name: ClineDefaultTool // id of the tool being used
	// params is a partial record, allowing only some or none of the possible parameters to be used
	params: Partial<Record<ToolParamName, string>>
	partial: boolean
}

// export interface AssistantMessage {
// 	textContent: TextContent
// 	toolCalls: ToolCall[]
// }

export type AssistantMessageContent = TextContent | ToolCall

export interface TextContent {
	type: "text"
	content: string
	partial: boolean
}

export const toolCallNames = [
	"execute_command",
	"read_file",
	"write_to_file",
	"search_files",
	"list_files",
	"list_code_definition_names",
	"inspect_site",
	"ask_followup_question",
	"attempt_completion",
] as const

// Converts array of tool call names into a union type ("execute_command" | "read_file" | ...)
export type ToolCallName = (typeof toolCallNames)[number]

export const toolParamNames = [
	"command",
	"path",
	"content",
	"regex",
	"file_pattern",
	"recursive",
	"url",
	"question",
	"result",
] as const

export type ToolParamName = (typeof toolParamNames)[number]

export interface ToolCall {
	type: "tool_call"
	name: ToolCallName
	// params is a partial record, allowing only some or none of the possible parameters to be used
	params: Partial<Record<ToolParamName, string>>
	partial: boolean
}

interface ExecuteCommandToolCall extends ToolCall {
	name: "execute_command"
	// Pick<Record<ToolParamName, string>, "command"> makes "command" required, but Partial<> makes it optional
	params: Partial<Pick<Record<ToolParamName, string>, "command">>
}

interface ReadFileToolCall extends ToolCall {
	name: "read_file"
	params: Partial<Pick<Record<ToolParamName, string>, "path">>
}

interface WriteToFileToolCall extends ToolCall {
	name: "write_to_file"
	params: Partial<Pick<Record<ToolParamName, string>, "path" | "content">>
}

interface SearchFilesToolCall extends ToolCall {
	name: "search_files"
	params: Partial<Pick<Record<ToolParamName, string>, "path" | "regex" | "file_pattern">>
}

interface ListFilesToolCall extends ToolCall {
	name: "list_files"
	params: Partial<Pick<Record<ToolParamName, string>, "path" | "recursive">>
}

interface ListCodeDefinitionNamesToolCall extends ToolCall {
	name: "list_code_definition_names"
	params: Partial<Pick<Record<ToolParamName, string>, "path">>
}

interface InspectSiteToolCall extends ToolCall {
	name: "inspect_site"
	params: Partial<Pick<Record<ToolParamName, string>, "url">>
}

interface AskFollowupQuestionToolCall extends ToolCall {
	name: "ask_followup_question"
	params: Partial<Pick<Record<ToolParamName, string>, "question">>
}

interface AttemptCompletionToolCall extends ToolCall {
	name: "attempt_completion"
	params: Partial<Pick<Record<ToolParamName, string>, "result" | "command">>
}

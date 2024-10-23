/**
 * Represents the content of an assistant's message, which can be either text or a tool use.
 */
export type AssistantMessageContent = TextContent | ToolUse

export { parseAssistantMessage } from "./parse-assistant-message"

/**
 * Represents a text content block in an assistant's message.
 */
export interface TextContent {
	type: "text"
	content: string
	partial: boolean
}

/**
 * Array of valid tool use names.
 */
export const toolUseNames = [
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

/**
 * Union type of all valid tool use names.
 */
export type ToolUseName = (typeof toolUseNames)[number]

/**
 * Array of valid tool parameter names.
 */
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

/**
 * Union type of all valid tool parameter names.
 */
export type ToolParamName = (typeof toolParamNames)[number]

/**
 * Represents a tool use block in an assistant's message.
 */
export interface ToolUse {
	type: "tool_use"
	name: ToolUseName
	// params is a partial record, allowing only some or none of the possible parameters to be used
	params: Partial<Record<ToolParamName, string>>
	partial: boolean
}

/**
 * Specific tool use interface for executing commands.
 */
export interface ExecuteCommandToolUse extends ToolUse {
	name: "execute_command"
	// Pick<Record<ToolParamName, string>, "command"> makes "command" required, but Partial<> makes it optional
	params: Partial<Pick<Record<ToolParamName, string>, "command">>
}

/**
 * Specific tool use interface for reading files.
 */
export interface ReadFileToolUse extends ToolUse {
	name: "read_file"
	params: Partial<Pick<Record<ToolParamName, string>, "path">>
}

/**
 * Specific tool use interface for writing to files.
 */
export interface WriteToFileToolUse extends ToolUse {
	name: "write_to_file"
	params: Partial<Pick<Record<ToolParamName, string>, "path" | "content">>
}

/**
 * Specific tool use interface for searching files.
 */
export interface SearchFilesToolUse extends ToolUse {
	name: "search_files"
	params: Partial<Pick<Record<ToolParamName, string>, "path" | "regex" | "file_pattern">>
}

/**
 * Specific tool use interface for listing files.
 */
export interface ListFilesToolUse extends ToolUse {
	name: "list_files"
	params: Partial<Pick<Record<ToolParamName, string>, "path" | "recursive">>
}

/**
 * Specific tool use interface for listing code definition names.
 */
export interface ListCodeDefinitionNamesToolUse extends ToolUse {
	name: "list_code_definition_names"
	params: Partial<Pick<Record<ToolParamName, string>, "path">>
}

/**
 * Specific tool use interface for inspecting sites.
 */
export interface InspectSiteToolUse extends ToolUse {
	name: "inspect_site"
	params: Partial<Pick<Record<ToolParamName, string>, "url">>
}

/**
 * Specific tool use interface for asking follow-up questions.
 */
export interface AskFollowupQuestionToolUse extends ToolUse {
	name: "ask_followup_question"
	params: Partial<Pick<Record<ToolParamName, string>, "question">>
}

/**
 * Specific tool use interface for attempting completions.
 */
export interface AttemptCompletionToolUse extends ToolUse {
	name: "attempt_completion"
	params: Partial<Pick<Record<ToolParamName, string>, "result" | "command">>
}

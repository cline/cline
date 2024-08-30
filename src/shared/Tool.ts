import { Anthropic } from "@anthropic-ai/sdk"

export type ToolName =
	| "write_to_file"
	| "read_file"
	| "list_files"
	| "list_code_definition_names"
	| "search_files"
	| "execute_command"
	| "ask_followup_question"
	| "attempt_completion"

export type Tool = Omit<Anthropic.Tool, "name"> & {
	name: ToolName
}

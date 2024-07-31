import { Anthropic } from "@anthropic-ai/sdk"

export type ToolName =
	| "write_to_file"
	| "read_file"
	| "list_files_top_level"
	| "list_files_recursive"
	| "view_source_code_definitions_top_level"
	| "execute_command"
	| "ask_followup_question"
	| "attempt_completion"

export type Tool = Omit<Anthropic.Tool, "name"> & {
	name: ToolName
}

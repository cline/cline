import { Anthropic } from "@anthropic-ai/sdk"

export type ToolName =
	| "write_to_file"
	| "read_file"
	| "analyze_project"
	| "list_files"
	| "execute_command"
	| "ask_followup_question"
	| "attempt_completion"

export type Tool = Omit<Anthropic.Tool, "name"> & {
	name: ToolName
}

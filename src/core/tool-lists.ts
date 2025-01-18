// Shared tools for architect and ask modes - read-only operations plus MCP and browser tools
export const READONLY_ALLOWED_TOOLS = [
	"read_file",
	"search_files",
	"list_files",
	"list_code_definition_names",
	"browser_action",
	"use_mcp_tool",
	"access_mcp_resource",
	"ask_followup_question",
	"attempt_completion",
] as const

// Code mode has access to all tools
export const CODE_ALLOWED_TOOLS = [
	"execute_command",
	"read_file",
	"write_to_file",
	"apply_diff",
	"search_files",
	"list_files",
	"list_code_definition_names",
	"browser_action",
	"use_mcp_tool",
	"access_mcp_resource",
	"ask_followup_question",
	"attempt_completion",
] as const

// Tool name types for type safety
export type ReadOnlyToolName = (typeof READONLY_ALLOWED_TOOLS)[number]
export type ToolName = (typeof CODE_ALLOWED_TOOLS)[number]

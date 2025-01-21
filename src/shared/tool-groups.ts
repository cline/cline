// Define tool group values
export type ToolGroupValues = readonly string[]

// Map of tool slugs to their display names
export const TOOL_DISPLAY_NAMES = {
	execute_command: "run commands",
	read_file: "read files",
	write_to_file: "write files",
	apply_diff: "apply changes",
	search_files: "search files",
	list_files: "list files",
	list_code_definition_names: "list definitions",
	browser_action: "use a browser",
	use_mcp_tool: "use mcp tools",
	access_mcp_resource: "access mcp resources",
	ask_followup_question: "ask questions",
	attempt_completion: "complete tasks",
} as const

// Define available tool groups
export const TOOL_GROUPS: Record<string, ToolGroupValues> = {
	read: ["read_file", "search_files", "list_files", "list_code_definition_names"],
	edit: ["write_to_file", "apply_diff"],
	browser: ["browser_action"],
	command: ["execute_command"],
	mcp: ["use_mcp_tool", "access_mcp_resource"],
}

export type ToolGroup = keyof typeof TOOL_GROUPS

// Tools that are always available to all modes
export const ALWAYS_AVAILABLE_TOOLS = ["ask_followup_question", "attempt_completion"] as const

// Tool name types for type safety
export type ToolName = keyof typeof TOOL_DISPLAY_NAMES

// Tool helper functions
export function getToolName(toolConfig: string | readonly [ToolName, ...any[]]): ToolName {
	return typeof toolConfig === "string" ? (toolConfig as ToolName) : toolConfig[0]
}

export function getToolOptions(toolConfig: string | readonly [ToolName, ...any[]]): any {
	return typeof toolConfig === "string" ? undefined : toolConfig[1]
}

// Display names for groups in UI
export const GROUP_DISPLAY_NAMES: Record<ToolGroup, string> = {
	read: "Read Files",
	edit: "Edit Files",
	browser: "Use Browser",
	command: "Run Commands",
	mcp: "Use MCP",
}

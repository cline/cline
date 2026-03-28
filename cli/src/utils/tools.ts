/**
 * Shared tool utilities for CLI components
 * Centralizes tool name handling and categorization
 */

/**
 * Tools that perform file edits (create, modify, delete)
 * Used to determine when to show DiffView and skip dynamic rendering
 */
export const FILE_EDIT_TOOLS = new Set([
	"editedExistingFile",
	"newFileCreated",
	"replace_in_file",
	"write_to_file",
	"fileDeleted",
])

/**
 * Tools that save/modify files (subset used for "Save" button label)
 */
export const FILE_SAVE_TOOLS = new Set(["editedExistingFile", "newFileCreated", "fileDeleted"])

/**
 * Check if a tool name is a file edit tool
 */
export function isFileEditTool(toolName: string | undefined): boolean {
	if (!toolName) return false
	return FILE_EDIT_TOOLS.has(toolName)
}

/**
 * Check if a tool name is a file save tool (for button labeling)
 */
export function isFileSaveTool(toolName: string | undefined): boolean {
	if (!toolName) return false
	return FILE_SAVE_TOOLS.has(toolName)
}

/**
 * Normalize tool name to snake_case for consistent lookups
 * Handles both camelCase (readFile) and snake_case (read_file) inputs
 */
export function normalizeToolName(toolName: string): string {
	// Convert camelCase to snake_case
	return toolName.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()
}

/**
 * Tool descriptions for display
 * Uses snake_case keys - use normalizeToolName() before lookup
 */
export const TOOL_DESCRIPTIONS: Record<string, { ask: string; say: string }> = {
	// File operations
	read_file: { ask: "wants to read this file", say: "read this file" },
	write_to_file: { ask: "wants to create a new file", say: "created a new file" },
	new_file_created: { ask: "wants to create a new file", say: "created a new file" },
	replace_in_file: { ask: "wants to edit this file", say: "edited this file" },
	edited_existing_file: { ask: "wants to edit this file", say: "edited this file" },

	// Directory operations
	list_files: { ask: "wants to view files in this directory", say: "viewed files in this directory" },
	list_files_top_level: { ask: "wants to view files in this directory", say: "viewed files in this directory" },
	list_files_recursive: {
		ask: "wants to recursively view all files in this directory",
		say: "recursively viewed all files in this directory",
	},
	list_code_definition_names: {
		ask: "wants to view code definitions in this directory",
		say: "viewed code definitions in this directory",
	},
	search_files: { ask: "wants to search files", say: "searched files" },

	// Command execution
	execute_command: { ask: "wants to execute this command", say: "executed this command" },

	// Browser
	browser_action: { ask: "wants to use the browser", say: "used the browser" },

	// MCP
	use_mcp_tool: { ask: "wants to use an MCP tool", say: "used an MCP tool" },
	access_mcp_resource: { ask: "wants to access an MCP resource", say: "accessed an MCP resource" },

	// Web
	web_fetch: { ask: "wants to fetch content from this URL", say: "fetched content from this URL" },
	web_search: { ask: "wants to search the web", say: "searched the web" },

	// Other
	ask_followup_question: { ask: "wants to ask a question", say: "asked a question" },
	attempt_completion: { ask: "wants to complete the task", say: "completed the task" },
	new_task: { ask: "wants to create a new task", say: "created a new task" },
	focus_chain: { ask: "wants to update the todo list", say: "updated the todo list" },
}

/**
 * Default description for unknown tools
 */
export const DEFAULT_TOOL_DESCRIPTION = {
	ask: "wants to use a tool",
	say: "used a tool",
}

/**
 * Get tool description with normalized lookup
 */
export function getToolDescription(toolName: string): { ask: string; say: string } {
	const normalized = normalizeToolName(toolName)
	return TOOL_DESCRIPTIONS[normalized] || DEFAULT_TOOL_DESCRIPTION
}

/**
 * Safely parse JSON from message text
 * Returns the parsed object or a default value if parsing fails
 */
export function parseMessageJson<T>(text: string | undefined, defaultValue: T): T {
	if (!text) return defaultValue
	try {
		return JSON.parse(text) as T
	} catch {
		return defaultValue
	}
}

/**
 * Parse tool info from message text
 */
export function parseToolFromMessage(
	text: string | undefined,
): { toolName: string; args: Record<string, unknown>; result?: string } | null {
	if (!text) return null
	try {
		const parsed = JSON.parse(text)
		if (parsed.tool) {
			return {
				toolName: parsed.tool,
				args: parsed,
				result: parsed.content || parsed.output,
			}
		}
		return null
	} catch {
		return null
	}
}

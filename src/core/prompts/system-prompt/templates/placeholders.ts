/**
 * Standard placeholder definitions used across prompt templates
 */
export const STANDARD_PLACEHOLDERS = {
	// System Information
	SYSTEM_INFO: "SYSTEM_INFO",
	OS: "OS",
	SHELL: "SHELL",
	HOME_DIR: "HOME_DIR",
	WORKING_DIR: "WORKING_DIR",

	// Tools and Capabilities
	TOOL_USE: "TOOL_USE",
	TOOLS: "TOOLS",
	TOOL_USE_SECTION: "TOOL_USE_SECTION",
	BROWSER_TOOLS: "BROWSER_TOOLS",
	MCP_TOOLS: "MCP_TOOLS",

	// MCP Servers
	MCP_SECTION: "MCP_SECTION",
	MCP_SERVERS: "MCP_SERVERS",

	// User Instructions
	USER_INSTRUCTIONS: "USER_INSTRUCTIONS",
	CUSTOM_RULES: "CUSTOM_RULES",

	// File Operations
	EDITING_FILES: "EDITING_FILES",
	FILE_OPERATIONS: "FILE_OPERATIONS",

	// Task Management
	TODO_SECTION: "TODO_SECTION",
	TASK_PROGRESS: "TASK_PROGRESS",

	// Mode and Context
	ACT_VS_PLAN_MODE: "ACT_VS_PLAN_MODE",
	PLAN_MODE_SECTION: "PLAN_MODE_SECTION",

	// Capabilities and Rules
	CAPABILITIES: "CAPABILITIES",
	FEEDBACK: "FEEDBACK",
	RULES: "RULES",
	OBJECTIVE: "OBJECTIVE",

	// Context Variables
	CWD: "CWD",
	SUPPORTS_BROWSER: "SUPPORTS_BROWSER",
	MODEL_FAMILY: "MODEL_FAMILY",

	// Dynamic Content
	CURRENT_DATE: "CURRENT_DATE",
	USER_NAME: "USER_NAME",
	PROJECT_TYPE: "PROJECT_TYPE",
} as const

export type StandardPlaceholder = (typeof STANDARD_PLACEHOLDERS)[keyof typeof STANDARD_PLACEHOLDERS]

/**
 * Required placeholders that must be provided for basic prompt functionality
 */
export const REQUIRED_PLACEHOLDERS: StandardPlaceholder[] = [
	STANDARD_PLACEHOLDERS.SYSTEM_INFO,
	STANDARD_PLACEHOLDERS.TOOL_USE,
	STANDARD_PLACEHOLDERS.CWD,
]

/**
 * Optional placeholders that enhance prompt functionality when available
 */
export const OPTIONAL_PLACEHOLDERS: StandardPlaceholder[] = [
	STANDARD_PLACEHOLDERS.MCP_SECTION,
	STANDARD_PLACEHOLDERS.USER_INSTRUCTIONS,
	STANDARD_PLACEHOLDERS.TODO_SECTION,
	STANDARD_PLACEHOLDERS.BROWSER_TOOLS,
]

/**
 * Validates that all required placeholders are present in the provided values
 */
export function validateRequiredPlaceholders(placeholders: Record<string, unknown>): string[] {
	const missing: string[] = []

	for (const required of REQUIRED_PLACEHOLDERS) {
		if (!(required in placeholders) || placeholders[required] === undefined) {
			missing.push(required)
		}
	}

	return missing
}

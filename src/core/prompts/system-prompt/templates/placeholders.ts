export enum SystemPromptSection {
	AGENT_ROLE = "AGENT_ROLE_SECTION",
	TOOL_USE = "TOOL_USE_SECTION",
	TOOLS = "TOOLS_SECTION",
	MCP = "MCP_SECTION",
	EDITING_FILES = "EDITING_FILES_SECTION",
	ACT_VS_PLAN = "ACT_VS_PLAN_SECTION",
	TODO = "TODO_SECTION",
	CAPABILITIES = "CAPABILITIES_SECTION",
	RULES = "RULES_SECTION",
	SYSTEM_INFO = "SYSTEM_INFO_SECTION",
	OBJECTIVE = "OBJECTIVE_SECTION",
	USER_INSTRUCTIONS = "USER_INSTRUCTIONS_SECTION",
	FEEDBACK = "FEEDBACK_SECTION",
}

/**
 * Standard placeholder definitions used across prompt templates
 */
export const STANDARD_PLACEHOLDERS = {
	// System Information
	OS: "OS",
	SHELL: "SHELL",
	HOME_DIR: "HOME_DIR",
	WORKING_DIR: "WORKING_DIR",

	// Tools and Capabilities
	BROWSER_TOOLS: "BROWSER_TOOLS",
	MCP_TOOLS: "MCP_TOOLS",

	// MCP Servers
	MCP_SERVERS: "MCP_SERVERS",

	// User Instructions
	CUSTOM_RULES: "CUSTOM_RULES",

	// File Operations
	FILE_OPERATIONS: "FILE_OPERATIONS",

	// Task Management
	TASK_PROGRESS: "TASK_PROGRESS",

	// Mode and Context
	PLAN_MODE_SECTION: "PLAN_MODE_SECTION",

	// Context Variables
	CWD: "CWD",
	SUPPORTS_BROWSER: "SUPPORTS_BROWSER",
	MODEL_FAMILY: "MODEL_FAMILY",

	// Dynamic Content
	CURRENT_DATE: "CURRENT_DATE",
	USER_NAME: "USER_NAME",
	PROJECT_TYPE: "PROJECT_TYPE",
	...SystemPromptSection,
} as const

export type StandardPlaceholder = (typeof STANDARD_PLACEHOLDERS)[keyof typeof STANDARD_PLACEHOLDERS]

/**
 * Required placeholders that must be provided for basic prompt functionality
 */
export const REQUIRED_PLACEHOLDERS: StandardPlaceholder[] = [
	STANDARD_PLACEHOLDERS.AGENT_ROLE,
	STANDARD_PLACEHOLDERS.TOOL_USE,
	STANDARD_PLACEHOLDERS.CWD,
]

/**
 * Optional placeholders that enhance prompt functionality when available
 */
export const OPTIONAL_PLACEHOLDERS: StandardPlaceholder[] = [
	STANDARD_PLACEHOLDERS.FEEDBACK,
	STANDARD_PLACEHOLDERS.USER_INSTRUCTIONS,
	STANDARD_PLACEHOLDERS.TODO,
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

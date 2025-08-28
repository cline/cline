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
	TASK_PROGRESS = "TASK_PROGRESS_SECTION",
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

	// MCP Servers
	MCP_SERVERS_LIST: "MCP_SERVERS_LIST",

	// Context Variables
	CWD: "CWD",
	SUPPORTS_BROWSER: "SUPPORTS_BROWSER",
	MODEL_FAMILY: "MODEL_FAMILY",

	// Dynamic Content
	CURRENT_DATE: "CURRENT_DATE",
	...SystemPromptSection,
} as const

export type StandardPlaceholder = (typeof STANDARD_PLACEHOLDERS)[keyof typeof STANDARD_PLACEHOLDERS]

/**
 * Required placeholders that must be provided for basic prompt functionality
 */
export const REQUIRED_PLACEHOLDERS: StandardPlaceholder[] = [STANDARD_PLACEHOLDERS.AGENT_ROLE, STANDARD_PLACEHOLDERS.SYSTEM_INFO]

/**
 * Optional placeholders that enhance prompt functionality when available
 */
export const OPTIONAL_PLACEHOLDERS: StandardPlaceholder[] = [
	STANDARD_PLACEHOLDERS.FEEDBACK,
	STANDARD_PLACEHOLDERS.USER_INSTRUCTIONS,
	STANDARD_PLACEHOLDERS.TODO,
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

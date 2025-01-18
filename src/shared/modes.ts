// Tool options for specific tools
export type ToolOptions = {
	string: readonly string[]
}

// Tool configuration tuple type
export type ToolConfig = readonly [string] | readonly [string, ToolOptions]

// Mode types
export type Mode = string

// Mode configuration type
export type ModeConfig = {
	slug: string
	name: string
	roleDefinition: string
	tools: readonly ToolConfig[]
}

// Separate enhance prompt type and definition
export type EnhanceConfig = {
	prompt: string
}

export const enhance: EnhanceConfig = {
	prompt: "Generate an enhanced version of this prompt (reply with only the enhanced prompt - no conversation, explanations, lead-in, bullet points, placeholders, or surrounding quotes):",
} as const

// Main modes configuration as an ordered array
export const modes: readonly ModeConfig[] = [
	{
		slug: "code",
		name: "Code",
		roleDefinition:
			"You are Cline, a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.",
		tools: [
			["execute_command"],
			["read_file"],
			["write_to_file"],
			["apply_diff"],
			["search_files"],
			["list_files"],
			["list_code_definition_names"],
			["browser_action"],
			["use_mcp_tool"],
			["access_mcp_resource"],
			["ask_followup_question"],
			["attempt_completion"],
		] as const,
	},
	{
		slug: "architect",
		name: "Architect",
		roleDefinition:
			"You are Cline, a software architecture expert specializing in analyzing codebases, identifying patterns, and providing high-level technical guidance. You excel at understanding complex systems, evaluating architectural decisions, and suggesting improvements while maintaining a read-only approach to the codebase. Make sure to help the user come up with a solid implementation plan for their project and don't rush to switch to implementing code.",
		tools: [
			["read_file"],
			["search_files"],
			["list_files"],
			["list_code_definition_names"],
			["browser_action"],
			["use_mcp_tool"],
			["access_mcp_resource"],
			["ask_followup_question"],
			["attempt_completion"],
		] as const,
	},
	{
		slug: "ask",
		name: "Ask",
		roleDefinition:
			"You are Cline, a knowledgeable technical assistant focused on answering questions and providing information about software development, technology, and related topics. You can analyze code, explain concepts, and access external resources while maintaining a read-only approach to the codebase. Make sure to answer the user's questions and don't rush to switch to implementing code.",
		tools: [
			["read_file"],
			["search_files"],
			["list_files"],
			["list_code_definition_names"],
			["browser_action"],
			["use_mcp_tool"],
			["access_mcp_resource"],
			["ask_followup_question"],
			["attempt_completion"],
		] as const,
	},
	{
		slug: "test",
		name: "Test",
		roleDefinition:
			"You are Cline, a software test engineering expert specializing in writing comprehensive test suites and ensuring thorough test coverage. You excel at writing unit tests, integration tests, and end-to-end tests that cover all edge cases while maintaining existing behavior. You must ask the user to confirm before making ANY changes to non-test code, and before implementing any test changes, you always ask the user to confirm your test plan. You focus on: 1) Writing tests that verify functionality without changing existing behavior, 2) Ensuring comprehensive test coverage including edge cases and error conditions, 3) Following testing best practices and patterns appropriate for the language/framework, 4) Using mocks, stubs, and fixtures effectively, 5) Writing clear, maintainable test code with descriptive names and good documentation.",
		tools: [
			["execute_command"],
			["read_file"],
			["write_to_file"],
			["apply_diff"],
			["search_files"],
			["list_files"],
			["list_code_definition_names"],
			["browser_action"],
			["use_mcp_tool"],
			["access_mcp_resource"],
			["ask_followup_question"],
			["attempt_completion"],
		] as const,
	},
	{
		slug: "review",
		name: "Review",
		roleDefinition:
			"You are Cline, a code review expert specializing in providing detailed, actionable feedback on code quality and maintainability. You excel at: 1) Identifying potential bugs, security vulnerabilities, and performance issues, 2) Ensuring code follows project standards, patterns, and best practices, 3) Checking for proper error handling and edge cases, 4) Verifying documentation completeness and clarity, 5) Suggesting specific, actionable improvements with examples. You maintain a read-only approach to the codebase and focus on helping developers improve their code through clear, constructive feedback.",
		tools: [
			["read_file"],
			["search_files"],
			["list_files"],
			["list_code_definition_names"],
			["browser_action"],
			["use_mcp_tool"],
			["access_mcp_resource"],
			["ask_followup_question"],
			["attempt_completion"],
		] as const,
	},
] as const

// Export the default mode slug
export const defaultModeSlug = modes[0].slug

// Helper functions
export function getModeBySlug(slug: string): ModeConfig | undefined {
	return modes.find((mode) => mode.slug === slug)
}

export function getModeConfig(slug: string): ModeConfig {
	const mode = getModeBySlug(slug)
	if (!mode) {
		throw new Error(`No mode found for slug: ${slug}`)
	}
	return mode
}

// Derive tool names from the modes configuration
export type ToolName = (typeof modes)[number]["tools"][number][0]
export type TestToolName = ToolName | "unknown_tool"

export function isToolAllowedForMode(tool: TestToolName, modeSlug: string): boolean {
	if (tool === "unknown_tool") {
		return false
	}
	const mode = getModeBySlug(modeSlug)
	if (!mode) {
		return false
	}
	return mode.tools.some(([toolName]) => toolName === tool)
}

export function getToolOptions(tool: ToolName, modeSlug: string): ToolOptions | undefined {
	const mode = getModeBySlug(modeSlug)
	if (!mode) {
		return undefined
	}
	const toolConfig = mode.tools.find(([toolName]) => toolName === tool)
	return toolConfig?.[1]
}

export type PromptComponent = {
	roleDefinition?: string
	customInstructions?: string
}

export type CustomPrompts = {
	[key: string]: PromptComponent | string | undefined
}

// Create the defaultPrompts object with the correct type
export const defaultPrompts: CustomPrompts = {
	...Object.fromEntries(modes.map((mode) => [mode.slug, { roleDefinition: mode.roleDefinition }])),
	enhance: enhance.prompt,
} as const

// Helper function to safely get role definition
export function getRoleDefinition(modeSlug: string): string {
	const prompt = defaultPrompts[modeSlug]
	if (!prompt || typeof prompt === "string") {
		throw new Error(`Invalid mode slug: ${modeSlug}`)
	}
	if (!prompt.roleDefinition) {
		throw new Error(`No role definition found for mode: ${modeSlug}`)
	}
	return prompt.roleDefinition
}

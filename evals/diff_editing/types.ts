import { Anthropic } from "@anthropic-ai/sdk"
import { ToolUseName, ToolParamName } from "../../src/core/assistant-message"

export interface InputMessage {
	role: "user" | "assistant"
	text: string
	images?: string[]
}

export interface ProcessedTestCase {
	test_id: string
	messages: Anthropic.Messages.MessageParam[]
	file_contents: string
	file_path: string
	system_prompt_details: SystemPromptDetails
	original_diff_edit_tool_call_message: string
}

export interface TestCase {
	test_id: string
	messages: InputMessage[]
	file_contents: string
	file_path: string
	system_prompt_details: SystemPromptDetails
	original_diff_edit_tool_call_message: string
}

export interface TestConfig {
	model_id: string
	system_prompt_name: string
	number_of_runs: number
	parsing_function: string
	diff_edit_function: string
	thinking_tokens_budget: number
	replay: boolean
}

export interface SystemPromptDetails {
	mcp_string: string
	cwd_value: string
	browser_use: boolean
	width: number
	height: number
	os_value: string
	shell_value: string
	home_value: string
	user_custom_instructions: string
}

export type ConstructSystemPromptFn = (
	cwdFormatted: string,
	supportsBrowserUse: boolean,
	browserWidth: number,
	browserHeight: number,
	os: string,
	shell: string,
	homeFormatted: string,
	mcpHubString: string,
	userCustomInstructions: string,
) => string

export interface TestResult {
	success: boolean
	streamResult?: any
	diffEdit?: string
	toolCalls?: ExtractedToolCall[]
	diffEditSuccess?: boolean
	error?: string
	errorString?: string
}

export interface ExtractedToolCall {
	name: ToolUseName
	input: Partial<Record<ToolParamName, string>>
}

export interface TestInput {
	apiKey?: string
	systemPrompt: string
	messages: Anthropic.Messages.MessageParam[]
	modelId: string
	originalFile: string
	originalFilePath: string
	parsingFunction: string
	diffEditFunction: string
	thinkingBudgetTokens: number
	originalDiffEditToolCallMessage?: string
}

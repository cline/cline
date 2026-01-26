/**
 * Claude Code style chat message component
 * Renders messages with:
 * - ❯ for user messages
 * - ⏺ for assistant messages and tool calls
 * - ⎿ for tool results (indented)
 */

import { COMMAND_OUTPUT_STRING } from "@shared/combineCommandSequences"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { Box, Text } from "ink"
import React from "react"
import { jsonParseSafe } from "../utils/parser"
import { DiffView } from "./DiffView"

/**
 * Render inline markdown: **bold**, *italic*, `code`
 * Returns array of React nodes with appropriate styling
 */
function renderInlineMarkdown(text: string): React.ReactNode[] {
	const nodes: React.ReactNode[] = []
	// Match **bold**, *italic*, or `code` - order matters (** before *)
	const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
	let lastIndex = 0
	let match

	while ((match = regex.exec(text)) !== null) {
		// Add text before match
		if (match.index > lastIndex) {
			nodes.push(text.slice(lastIndex, match.index))
		}

		const fullMatch = match[0]
		const key = `md-${match.index}`

		if (fullMatch.startsWith("**") && fullMatch.endsWith("**")) {
			// Bold
			nodes.push(
				<Text bold key={key}>
					{fullMatch.slice(2, -2)}
				</Text>,
			)
		} else if (fullMatch.startsWith("*") && fullMatch.endsWith("*")) {
			// Italic
			nodes.push(
				<Text italic key={key}>
					{fullMatch.slice(1, -1)}
				</Text>,
			)
		} else if (fullMatch.startsWith("`") && fullMatch.endsWith("`")) {
			// Inline code
			nodes.push(
				<Text dimColor key={key}>
					{fullMatch.slice(1, -1)}
				</Text>,
			)
		}

		lastIndex = regex.lastIndex
	}

	// Add remaining text
	if (lastIndex < text.length) {
		nodes.push(text.slice(lastIndex))
	}

	return nodes.length > 0 ? nodes : [text]
}

/**
 * Render text with inline markdown support
 */
const MarkdownText: React.FC<{ children: string; color?: string }> = ({ children, color }) => {
	const nodes = renderInlineMarkdown(children)
	return <Text color={color}>{nodes}</Text>
}

interface ChatMessageProps {
	message: ClineMessage
	isStreaming?: boolean
	mode?: "act" | "plan"
}

/**
 * Two-column layout for messages with a dot prefix.
 * Keeps content from wrapping under the dot.
 *
 * For this to work properly, parent containers must have width="100%"
 * so flexGrow={1} on the content box has a reference width to fill.
 */
const DotRow: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color }) => (
	<Box flexDirection="row">
		<Box width={2}>
			<Text color={color}>⏺</Text>
		</Box>
		<Box flexGrow={1}>{children}</Box>
	</Box>
)

/**
 * Two-column layout for tool results with ⎿ prefix.
 * Keeps content from wrapping under the prefix.
 */
const ResultRow: React.FC<{ children: React.ReactNode; isFirst?: boolean }> = ({ children, isFirst }) => (
	<Box flexDirection="row">
		<Box width={3}>
			<Text dimColor>{isFirst ? "⎿ " : "  "}</Text>
		</Box>
		<Box flexGrow={1}>{children}</Box>
	</Box>
)

// Tool descriptions for ask (pending) and say (completed) states
// Format: { ask: "wants to X", say: "X" } where X describes the action
interface ToolDescription {
	ask: string // e.g., "wants to read this file"
	say: string // e.g., "read this file"
}

const TOOL_DESCRIPTIONS: Record<string, ToolDescription> = {
	// File operations
	read_file: { ask: "wants to read this file", say: "read this file" },
	readFile: { ask: "wants to read this file", say: "read this file" },
	write_to_file: { ask: "wants to create a new file", say: "created a new file" },
	writeToFile: { ask: "wants to create a new file", say: "created a new file" },
	newFileCreated: { ask: "wants to create a new file", say: "created a new file" },
	replace_in_file: { ask: "wants to edit this file", say: "edited this file" },
	editedExistingFile: { ask: "wants to edit this file", say: "edited this file" },

	// Directory operations
	list_files: { ask: "wants to view files in this directory", say: "viewed files in this directory" },
	listFilesTopLevel: { ask: "wants to view files in this directory", say: "viewed files in this directory" },
	listFilesRecursive: {
		ask: "wants to recursively view all files in this directory",
		say: "recursively viewed all files in this directory",
	},
	list_code_definition_names: {
		ask: "wants to view code definitions in this directory",
		say: "viewed code definitions in this directory",
	},
	listCodeDefinitionNames: {
		ask: "wants to view code definitions in this directory",
		say: "viewed code definitions in this directory",
	},
	search_files: { ask: "wants to search files", say: "searched files" },
	searchFiles: { ask: "wants to search files", say: "searched files" },

	// Command execution
	execute_command: { ask: "wants to execute this command", say: "executed this command" },
	executeCommand: { ask: "wants to execute this command", say: "executed this command" },

	// Browser
	browser_action: { ask: "wants to use the browser", say: "used the browser" },
	browserAction: { ask: "wants to use the browser", say: "used the browser" },

	// MCP
	use_mcp_tool: { ask: "wants to use an MCP tool", say: "used an MCP tool" },
	useMcpTool: { ask: "wants to use an MCP tool", say: "used an MCP tool" },
	access_mcp_resource: { ask: "wants to access an MCP resource", say: "accessed an MCP resource" },
	accessMcpResource: { ask: "wants to access an MCP resource", say: "accessed an MCP resource" },

	// Web
	web_fetch: { ask: "wants to fetch content from this URL", say: "fetched content from this URL" },
	webFetch: { ask: "wants to fetch content from this URL", say: "fetched content from this URL" },
	web_search: { ask: "wants to search the web", say: "searched the web" },
	webSearch: { ask: "wants to search the web", say: "searched the web" },

	// Other
	ask_followup_question: { ask: "wants to ask a question", say: "asked a question" },
	askFollowupQuestion: { ask: "wants to ask a question", say: "asked a question" },
	attempt_completion: { ask: "wants to complete the task", say: "completed the task" },
	attemptCompletion: { ask: "wants to complete the task", say: "completed the task" },
	new_task: { ask: "wants to create a new task", say: "created a new task" },
	newTask: { ask: "wants to create a new task", say: "created a new task" },
	focus_chain: { ask: "wants to update the todo list", say: "updated the todo list" },
	focusChain: { ask: "wants to update the todo list", say: "updated the todo list" },
}

// Default description for unknown tools
const DEFAULT_TOOL_DESCRIPTION: ToolDescription = {
	ask: "wants to use a tool",
	say: "used a tool",
}

/**
 * Get the primary argument to display for a tool (file path, command, url, etc.)
 */
function getToolMainArg(toolName: string, args: Record<string, any>): string {
	// File path
	if (args.path) return args.path
	if (args.file_path) return args.file_path

	// Command - truncate long commands
	if (args.command) {
		return args.command.length > 60 ? args.command.substring(0, 57) + "..." : args.command
	}

	// Search regex
	if (args.regex) return args.regex

	// URL
	if (args.url) return args.url

	// Search query
	if (args.query) return args.query

	return ""
}

/**
 * Render a tool call in webview style: "Cline wants to read this file:" / "Cline read this file:"
 */
const ToolCallText: React.FC<{
	toolName: string
	args: Record<string, any>
	mode?: "act" | "plan"
	isAsk?: boolean
}> = ({ toolName, args, mode, isAsk = false }) => {
	const desc = TOOL_DESCRIPTIONS[toolName] || DEFAULT_TOOL_DESCRIPTION
	const actionText = isAsk ? desc.ask : desc.say
	const mainArg = getToolMainArg(toolName, args)
	const toolColor = mode === "plan" ? "yellow" : "blueBright"

	return (
		<Text>
			<Text color={toolColor}>Cline {actionText}</Text>
			{mainArg && (
				<Text>
					<Text color={toolColor}>: </Text>
					<Text>{mainArg}</Text>
				</Text>
			)}
		</Text>
	)
}

/**
 * Parse tool message to extract tool info
 */
function parseToolMessage(text: string): { toolName: string; args: Record<string, any>; result?: string } | null {
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

/**
 * Truncate text with ellipsis
 */
function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text
	return text.substring(0, maxLength - 3) + "..."
}

/**
 * Format tool result for display
 */
function formatToolResult(result: string, maxLines: number = 5): string[] {
	const lines = result.split("\n")
	if (lines.length <= maxLines) {
		return lines
	}
	const displayLines = lines.slice(0, maxLines)
	displayLines.push(`... ${lines.length - maxLines} more lines`)
	return displayLines
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, mode }) => {
	const { type, ask, say, text } = message
	const toolColor = mode === "plan" ? "yellow" : "blueBright"

	// User messages (task, user_feedback)
	if (say === "task" || say === "user_feedback") {
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Box backgroundColor="blackBright" paddingRight={1}>
					<Text color="white" dimColor>
						{" "}
						&gt;{" "}
					</Text>
					<Text color="white">{text}</Text>
				</Box>
			</Box>
		)
	}

	// Assistant text response and reasoning
	if (say === "text" || say === "reasoning") {
		if (!text?.trim()) return null
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow>
					<Text>{text}</Text>
				</DotRow>
			</Box>
		)
	}

	// Tool calls (ask for permission)
	if (type === "ask" && ask === "tool" && text) {
		const toolInfo = parseToolMessage(text)
		if (toolInfo) {
			// File edit tools - show diff
			const isFileEdit =
				toolInfo.toolName === "editedExistingFile" ||
				toolInfo.toolName === "newFileCreated" ||
				toolInfo.toolName === "replace_in_file" ||
				toolInfo.toolName === "write_to_file"
			const filePath = toolInfo.args.path || toolInfo.args.file_path

			if (isFileEdit && filePath && toolInfo.args.content) {
				return (
					<Box flexDirection="column" marginBottom={1} width="100%">
						<DotRow color={toolColor}>
							<ToolCallText args={toolInfo.args} isAsk mode={mode} toolName={toolInfo.toolName} />
						</DotRow>
						<Box marginLeft={2}>
							<DiffView content={toolInfo.args.content} />
						</Box>
					</Box>
				)
			}

			return (
				<Box flexDirection="column" marginBottom={1} width="100%">
					<DotRow color={toolColor}>
						<ToolCallText args={toolInfo.args} isAsk mode={mode} toolName={toolInfo.toolName} />
					</DotRow>
				</Box>
			)
		}
	}

	// Tool results (say tool)
	if (say === "tool" && text) {
		const toolInfo = parseToolMessage(text)
		if (toolInfo) {
			// File edit tools - show diff
			const isFileEdit =
				toolInfo.toolName === "editedExistingFile" ||
				toolInfo.toolName === "newFileCreated" ||
				toolInfo.toolName === "replace_in_file" ||
				toolInfo.toolName === "write_to_file"
			const filePath = toolInfo.args.path || toolInfo.args.file_path

			if (isFileEdit && filePath && toolInfo.args.content) {
				return (
					<Box flexDirection="column" marginBottom={1} width="100%">
						<DotRow color={toolColor}>
							<ToolCallText args={toolInfo.args} mode={mode} toolName={toolInfo.toolName} />
						</DotRow>
						<Box marginLeft={2}>
							<DiffView content={toolInfo.args.content} />
						</Box>
					</Box>
				)
			}

			const hasResult = toolInfo.result && toolInfo.result.trim()
			return (
				<Box flexDirection="column" marginBottom={1} width="100%">
					<DotRow color={toolColor}>
						<ToolCallText args={toolInfo.args} mode={mode} toolName={toolInfo.toolName} />
					</DotRow>
					{hasResult && (
						<Box flexDirection="column" marginLeft={2} width="100%">
							{formatToolResult(toolInfo.result!, 5).map((line, idx) => (
								<ResultRow isFirst={idx === 0} key={idx}>
									<Text dimColor>{line}</Text>
								</ResultRow>
							))}
						</Box>
					)}
				</Box>
			)
		}
		// Fallback for unparseable tool messages
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color={toolColor}>
					<Text color={toolColor}>{truncate(text, 100)}</Text>
				</DotRow>
			</Box>
		)
	}

	// Command execution (ask or say) - now includes combined output
	if ((type === "ask" && ask === "command") || say === "command") {
		if (!text) return null

		// Parse command and output from combined text
		const outputIndex = text.indexOf(COMMAND_OUTPUT_STRING)
		const command = outputIndex === -1 ? text : text.slice(0, outputIndex).trim()
		const output = outputIndex === -1 ? "" : text.slice(outputIndex + COMMAND_OUTPUT_STRING.length).trim()

		const isAsk = type === "ask"
		const label = isAsk ? "Cline wants to execute this command: " : "Cline executed this command: "

		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color={toolColor}>
					<Text>
						<Text color={toolColor}>{label}</Text>
						<Text>{truncate(command, 60)}</Text>
					</Text>
				</DotRow>
				{output && (
					<Box flexDirection="column" marginLeft={2} width="100%">
						{formatToolResult(output, 8).map((line, idx) => (
							<ResultRow isFirst={idx === 0} key={idx}>
								<Text dimColor>{line}</Text>
							</ResultRow>
						))}
					</Box>
				)}
			</Box>
		)
	}

	// Command output - should not appear after combineCommandSequences, but handle as fallback
	if (say === "command_output" && text) {
		const lines = formatToolResult(text, 8)
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<Box flexDirection="column" marginLeft={2} width="100%">
					{lines.map((line, idx) => (
						<ResultRow isFirst={idx === 0} key={idx}>
							<Text dimColor>{line}</Text>
						</ResultRow>
					))}
				</Box>
			</Box>
		)
	}

	// Error messages
	if (say === "error" || (type === "ask" && ask === "api_req_failed")) {
		// Try to parse error message if it's JSON
		let errorMessage = text || "Unknown error"
		if (text) {
			const parsed = jsonParseSafe(text, { message: undefined as string | undefined })
			if (parsed.message) {
				errorMessage = parsed.message
			}
		}
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color="red">
					<Text bold color="red">
						Error
					</Text>
					<Text color="red">: {errorMessage}</Text>
				</DotRow>
			</Box>
		)
	}

	// Error retry messages
	if (say === "error_retry" && text) {
		const retryInfo = jsonParseSafe(text, {
			failed: false,
			attempt: 0,
			maxAttempts: 3,
			errorMessage: undefined as string | undefined,
		})

		// Parse nested errorMessage if it's a JSON string
		let errorMsg = "Request failed"
		if (retryInfo.errorMessage) {
			try {
				const errorObj = jsonParseSafe(retryInfo.errorMessage, { message: undefined as string | undefined })
				errorMsg = errorObj.message || retryInfo.errorMessage
			} catch {
				errorMsg = retryInfo.errorMessage
			}
		}

		if (retryInfo.failed) {
			return (
				<Box flexDirection="column" marginBottom={1} width="100%">
					<DotRow color="red">
						<Text bold color="red">
							Failed
						</Text>
						<Text color="red"> after {retryInfo.maxAttempts} retries</Text>
					</DotRow>
					<Box marginLeft={2}>
						<Text color="red" dimColor>
							{errorMsg}
						</Text>
					</Box>
				</Box>
			)
		}
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color="yellow">
					<Text bold color="yellow">
						Retrying
					</Text>
					<Text color="yellow">
						... (attempt {retryInfo.attempt}/{retryInfo.maxAttempts})
					</Text>
				</DotRow>
				<Box marginLeft={2}>
					<Text color="yellow" dimColor>
						{errorMsg}
					</Text>
				</Box>
			</Box>
		)
	}

	// Completion result
	// Only render ask: "completion_result" if it has text - the empty ask is just for UI confirmation
	if (say === "completion_result" || (type === "ask" && ask === "completion_result" && text)) {
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color="green">
					<Text color="green">Task completed</Text>
				</DotRow>
				{text && (
					<Box marginLeft={2}>
						<MarkdownText color="greenBright">{text}</MarkdownText>
					</Box>
				)}
			</Box>
		)
	}

	// API request info (show cost/tokens inline)
	if (say === "api_req_started" && text) {
		// Skip showing these - they're summarized in the status bar
		return null
	}

	// Browser actions
	if (say === "browser_action" || say === "browser_action_launch") {
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color={toolColor}>
					<Text>
						<Text color={toolColor}>Cline used the browser</Text>
						{text && (
							<Text>
								<Text color={toolColor}>: </Text>
								<Text>{truncate(text, 50)}</Text>
							</Text>
						)}
					</Text>
				</DotRow>
			</Box>
		)
	}

	// MCP server
	if (say === "mcp_server_request_started") {
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color={toolColor}>
					<Text>
						<Text color={toolColor}>Cline is using an MCP tool</Text>
						{text && (
							<Text>
								<Text color={toolColor}>: </Text>
								<Text>{truncate(text, 50)}</Text>
							</Text>
						)}
					</Text>
				</DotRow>
			</Box>
		)
	}

	// Info messages
	if (say === "info") {
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color="gray">
					<Text color="gray">{text}</Text>
				</DotRow>
			</Box>
		)
	}

	// Followup questions from assistant
	if (type === "ask" && ask === "followup" && text) {
		const parsed = jsonParseSafe(text, {
			question: undefined as string | undefined,
			options: undefined as string[] | undefined,
			selected: undefined as string | undefined,
		})
		if (parsed.question) {
			return (
				<Box flexDirection="column" marginBottom={1} width="100%">
					<DotRow>
						<MarkdownText>{parsed.question}</MarkdownText>
					</DotRow>
					{parsed.options && parsed.options.length > 0 && (
						<Box flexDirection="column" paddingLeft={2}>
							{parsed.options.map((opt, idx) => {
								const isSelected = parsed.selected === opt
								return (
									<Text color={isSelected ? "green" : "gray"} key={opt}>
										{isSelected ? "✓" : `${idx + 1}.`} {opt}
									</Text>
								)
							})}
						</Box>
					)}
				</Box>
			)
		}
	}

	// Plan mode response
	if (type === "ask" && ask === "plan_mode_respond" && text) {
		const parsed = jsonParseSafe(text, { response: undefined as string | undefined })
		if (parsed.response) {
			return (
				<Box flexDirection="column" marginBottom={1} width="100%">
					<DotRow color="yellow">
						<MarkdownText color="yellow">{parsed.response}</MarkdownText>
					</DotRow>
				</Box>
			)
		}
	}

	// Skip other message types
	return null
}

/**
 * Render a list of messages in Claude Code style
 */
interface ChatMessageListProps {
	messages: ClineMessage[]
	maxMessages?: number
}

export const ChatMessageList: React.FC<ChatMessageListProps> = ({ messages, maxMessages }) => {
	// Filter out messages we don't want to display
	const displayMessages = messages.filter((m) => {
		// Skip api_req_finished, they're just markers
		if (m.say === "api_req_finished") return false
		// Skip empty text messages
		if (m.say === "text" && !m.text?.trim()) return false
		// Skip checkpoint messages
		if (m.say === "checkpoint_created") return false
		return true
	})

	// Optionally limit number of messages shown
	const messagesToShow = maxMessages ? displayMessages.slice(-maxMessages) : displayMessages

	// Check if last message is streaming
	const lastMessage = messagesToShow[messagesToShow.length - 1]
	const isLastStreaming = lastMessage?.partial === true

	return (
		<Box flexDirection="column">
			{messagesToShow.map((msg, idx) => (
				<ChatMessage isStreaming={idx === messagesToShow.length - 1 && isLastStreaming} key={msg.ts} message={msg} />
			))}
		</Box>
	)
}

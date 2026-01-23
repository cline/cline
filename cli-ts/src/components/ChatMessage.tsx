/**
 * Claude Code style chat message component
 * Renders messages with:
 * - ❯ for user messages
 * - ⏺ for assistant messages and tool calls
 * - ⎿ for tool results (indented)
 */

import type { ClineMessage } from "@shared/ExtensionMessage"
import { Box, Text } from "ink"
import React from "react"
import { jsonParseSafe } from "../utils/parser"

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
}

// Tool name display mapping - convert internal names to user-friendly names
const TOOL_DISPLAY_NAMES: Record<string, string> = {
	read_file: "Read",
	write_to_file: "Write",
	replace_in_file: "Edit",
	execute_command: "Bash",
	search_files: "Search",
	list_files: "List",
	list_code_definition_names: "Definitions",
	browser_action: "Browser",
	use_mcp_tool: "MCP",
	access_mcp_resource: "MCP Resource",
	ask_followup_question: "Question",
	attempt_completion: "Complete",
	web_fetch: "Fetch",
	web_search: "WebSearch",
	new_task: "Task",
	focus_chain: "Todo",
}

/**
 * Format tool call in Claude Code style
 * e.g., Read(src/components/App.tsx)
 */
function formatToolCall(toolName: string, args: Record<string, any>): string {
	const displayName = TOOL_DISPLAY_NAMES[toolName] || toolName

	// Extract the most relevant argument for display
	let mainArg = ""
	if (args.path) {
		mainArg = args.path
	} else if (args.file_path) {
		mainArg = args.file_path
	} else if (args.command) {
		mainArg = args.command.length > 50 ? args.command.substring(0, 47) + "..." : args.command
	} else if (args.regex) {
		mainArg = `pattern: "${args.regex}"`
		if (args.file_pattern) {
			mainArg += `, path: "${args.file_pattern}"`
		}
	} else if (args.url) {
		mainArg = args.url
	} else if (args.query) {
		mainArg = args.query
	} else if (args.question) {
		mainArg = args.question.length > 40 ? args.question.substring(0, 37) + "..." : args.question
	} else if (args.result) {
		mainArg = args.result.length > 40 ? args.result.substring(0, 37) + "..." : args.result
	}

	return mainArg ? `${displayName}(${mainArg})` : displayName
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

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, isStreaming }) => {
	const { type, ask, say, text } = message

	// User messages (task, user_feedback) - bubble style with background and >
	if (say === "task" || say === "user_feedback") {
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Box backgroundColor="gray" paddingLeft={1} paddingRight={1} width="100%">
					<Text color="white">&gt; {text}</Text>
				</Box>
			</Box>
		)
	}

	// Assistant text response
	if (say === "text") {
		if (!text?.trim()) return null
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Box>
					<Text>⏺ </Text>
					<MarkdownText>{text}</MarkdownText>
				</Box>
			</Box>
		)
	}

	// Reasoning/thinking
	if (say === "reasoning") {
		if (!text?.trim()) return null
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Box>
					<Text color="yellow" italic>
						⏺ {truncate(text, 200)}
					</Text>
				</Box>
			</Box>
		)
	}

	// Tool calls (ask for permission)
	if (type === "ask" && ask === "tool" && text) {
		const toolInfo = parseToolMessage(text)
		if (toolInfo) {
			return (
				<Box flexDirection="column" marginBottom={1}>
					<Box>
						<Text color="blue">⏺ {formatToolCall(toolInfo.toolName, toolInfo.args)}</Text>
					</Box>
				</Box>
			)
		}
	}

	// Tool results (say tool)
	if (say === "tool" && text) {
		const toolInfo = parseToolMessage(text)
		if (toolInfo) {
			const hasResult = toolInfo.result && toolInfo.result.trim()
			return (
				<Box flexDirection="column" marginBottom={1}>
					<Box>
						<Text color="green">⏺ {formatToolCall(toolInfo.toolName, toolInfo.args)}</Text>
					</Box>
					{hasResult && (
						<Box flexDirection="column" marginLeft={2}>
							{formatToolResult(toolInfo.result!, 5).map((line, idx) => (
								<Box key={idx}>
									<Text dimColor>
										{idx === 0 ? "⎿  " : "   "}
										{line}
									</Text>
								</Box>
							))}
						</Box>
					)}
				</Box>
			)
		}
		// Fallback for unparseable tool messages
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Box>
					<Text color="green">⏺ {truncate(text, 100)}</Text>
				</Box>
			</Box>
		)
	}

	// Command execution ask
	if (type === "ask" && ask === "command" && text) {
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Box>
					<Text>⏺ Bash({truncate(text, 60)})</Text>
				</Box>
			</Box>
		)
	}

	// Command say (before execution)
	if (say === "command" && text) {
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Box>
					<Text>⏺ Bash({truncate(text, 60)})</Text>
				</Box>
			</Box>
		)
	}

	// Command output
	if (say === "command_output" && text) {
		const lines = formatToolResult(text, 8)
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Box flexDirection="column" marginLeft={2}>
					{lines.map((line, idx) => (
						<Box key={idx}>
							<Text dimColor>
								{idx === 0 ? "⎿  " : "   "}
								{line}
							</Text>
						</Box>
					))}
				</Box>
			</Box>
		)
	}

	// Error messages
	if (say === "error") {
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Box>
					<Text color="red">⏺ Error: {text}</Text>
				</Box>
			</Box>
		)
	}

	// Completion result
	if (say === "completion_result" || (type === "ask" && ask === "completion_result")) {
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Box flexDirection="column">
					<Box>
						<Text color="green">⏺ Task completed</Text>
					</Box>
					{text && (
						<Box marginLeft={2}>
							<MarkdownText color="green">{text}</MarkdownText>
						</Box>
					)}
				</Box>
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
			<Box flexDirection="column" marginBottom={1}>
				<Box>
					<Text>⏺ Browser({truncate(text || "", 50)})</Text>
				</Box>
			</Box>
		)
	}

	// MCP server
	if (say === "mcp_server_request_started") {
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Box>
					<Text>⏺ MCP({truncate(text || "", 50)})</Text>
				</Box>
			</Box>
		)
	}

	// Info messages
	if (say === "info") {
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Box>
					<Text color="gray">⏺ {text}</Text>
				</Box>
			</Box>
		)
	}

	// Followup questions from assistant
	if (type === "ask" && ask === "followup" && text) {
		const parsed = jsonParseSafe(text, { question: undefined as string | undefined })
		if (parsed.question) {
			return (
				<Box flexDirection="column" marginBottom={1}>
					<Box>
						<Text>⏺ </Text>
						<MarkdownText>{parsed.question}</MarkdownText>
					</Box>
				</Box>
			)
		}
	}

	// Plan mode response
	if (type === "ask" && ask === "plan_mode_respond" && text) {
		const parsed = jsonParseSafe(text, { response: undefined as string | undefined })
		if (parsed.response) {
			return (
				<Box flexDirection="column" marginBottom={1}>
					<Box>
						<Text color="yellow">⏺ </Text>
						<MarkdownText color="yellow">{parsed.response}</MarkdownText>
					</Box>
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

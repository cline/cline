/**
 * Claude Code style chat message component
 * Renders messages with:
 * - ❯ for user messages
 * - ⏺ for assistant messages and tool calls
 * - ⎿ for tool results (indented)
 */

import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "@shared/ClineAccount"
import { COMMAND_OUTPUT_STRING } from "@shared/combineCommandSequences"
import type { ClineAskUseMcpServer, ClineMessage } from "@shared/ExtensionMessage"
import { Box, Text } from "ink"
import React from "react"
import { COLORS } from "../constants/colors"
import { useTerminalSize } from "../hooks/useTerminalSize"
import { jsonParseSafe } from "../utils/parser"
import { getToolDescription, isFileEditTool, parseToolFromMessage } from "../utils/tools"
import { DiffView } from "./DiffView"

/**
 * Add "(Tab)" hint after "to Act Mode" mentions.
 * Case-insensitive, avoids double-adding if already present.
 */
function addActModeHint(text: string): React.ReactNode[] {
	// Match "to Act Mode" in various capitalizations, but not if already followed by (Tab)
	const actModeRegex = /\bto\s+Act\s+Mode\b(?!\s*\(Tab\))/gi
	const parts = text.split(actModeRegex)
	const matches = text.match(actModeRegex)

	if (!matches || parts.length <= 1) {
		return [text]
	}

	const nodes: React.ReactNode[] = []
	parts.forEach((part, i) => {
		if (part) {
			nodes.push(part)
		}
		if (matches[i]) {
			nodes.push(
				<React.Fragment key={`act-mode-${i}`}>
					{matches[i]}
					<Text color="gray"> (Tab)</Text>
				</React.Fragment>,
			)
		}
	})

	return nodes
}

/**
 * Render inline markdown: **bold**, *italic*, `code`
 * Also adds "(Tab)" hints after "to Act Mode" mentions.
 * Returns array of React nodes with appropriate styling
 */
function renderInlineMarkdown(text: string): React.ReactNode[] {
	const nodes: React.ReactNode[] = []
	// Match **bold**, *italic*, or `code` - order matters (** before *)
	const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
	let lastIndex = 0
	let match

	while ((match = regex.exec(text)) !== null) {
		// Add text before match (with Act Mode hint processing)
		if (match.index > lastIndex) {
			const beforeText = text.slice(lastIndex, match.index)
			nodes.push(...addActModeHint(beforeText))
		}

		const fullMatch = match[0]
		const key = `md-${match.index}`

		if (fullMatch.startsWith("**") && fullMatch.endsWith("**")) {
			// Bold - also process for Act Mode hints inside bold text
			const boldContent = fullMatch.slice(2, -2)
			const hintedContent = addActModeHint(boldContent)
			nodes.push(
				<Text bold key={key}>
					{hintedContent}
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
			nodes.push(<Text key={key}>{fullMatch.slice(1, -1)}</Text>)
		}

		lastIndex = regex.lastIndex
	}

	// Add remaining text (with Act Mode hint processing)
	if (lastIndex < text.length) {
		nodes.push(...addActModeHint(text.slice(lastIndex)))
	}

	return nodes.length > 0 ? nodes : addActModeHint(text)
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
			<Text color="gray">{isFirst ? "⎿ " : "  "}</Text>
		</Box>
		<Box flexGrow={1}>{children}</Box>
	</Box>
)

/**
 * Get the primary argument to display for a tool (file path, command, url, etc.)
 */
function getToolMainArg(_toolName: string, args: Record<string, unknown>): string {
	// Search files: show 'regex' in path
	if (typeof args.regex === "string" && typeof args.path === "string") {
		return `'${args.regex}' in ${args.path}`
	}

	// File path
	if (typeof args.path === "string") return args.path
	if (typeof args.file_path === "string") return args.file_path

	// Command - truncate long commands
	if (typeof args.command === "string") {
		return args.command.length > 120 ? args.command.substring(0, 117) + "..." : args.command
	}

	// URL
	if (typeof args.url === "string") return args.url

	// Search query
	if (typeof args.query === "string") return args.query

	return ""
}

/**
 * Render a tool call in webview style: "Cline wants to read this file:" / "Cline read this file:"
 */
const ToolCallText: React.FC<{
	toolName: string
	args: Record<string, unknown>
	mode?: "act" | "plan"
	isAsk?: boolean
}> = ({ toolName, args, mode, isAsk = false }) => {
	const desc = getToolDescription(toolName)
	const actionText = isAsk ? desc.ask : desc.say
	const mainArg = getToolMainArg(toolName, args)
	const toolColor = mode === "plan" ? "yellow" : COLORS.primaryBlue

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
	const toolColor = mode === "plan" ? "yellow" : COLORS.primaryBlue
	const { columns: terminalWidth } = useTerminalSize()

	// User messages (task, user_feedback)
	// If multi-line, extend background to full width for consistent appearance
	if (say === "task" || say === "user_feedback") {
		const content = "> " + (text || "")
		const isMultiLine = content.includes("\n") || content.length > terminalWidth

		if (isMultiLine) {
			return (
				<Box flexDirection="column" marginBottom={1} width="100%">
					<Box backgroundColor="blackBright" paddingX={1} width="100%">
						<Text color="white">{content}</Text>
					</Box>
				</Box>
			)
		}

		return (
			<Box flexDirection="column" marginBottom={1}>
				<Box backgroundColor="blackBright" paddingX={1}>
					<Text color="white">{content}</Text>
				</Box>
			</Box>
		)
	}

	// Assistant text response (hide reasoning traces - they're verbose and clutter the UI)
	if (say === "reasoning") {
		return null
	}
	if (say === "text") {
		if (!text?.trim()) return null
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow>
					<MarkdownText>{text}</MarkdownText>
				</DotRow>
			</Box>
		)
	}

	// Tool calls (ask) and tool results (say)
	const isToolAsk = type === "ask" && ask === "tool"
	const isToolSay = say === "tool"
	if ((isToolAsk || isToolSay) && text) {
		const toolInfo = parseToolFromMessage(text)
		if (toolInfo) {
			const filePath = toolInfo.args.path || toolInfo.args.file_path

			// File edit tools - show diff
			if (isFileEditTool(toolInfo.toolName) && filePath && toolInfo.args.content) {
				return (
					<Box flexDirection="column" marginBottom={1} width="100%">
						<DotRow color={toolColor}>
							<ToolCallText args={toolInfo.args} isAsk={isToolAsk} mode={mode} toolName={toolInfo.toolName} />
						</DotRow>
						<Box marginLeft={2}>
							<DiffView content={toolInfo.args.content} filePath={filePath as string | undefined} />
						</Box>
					</Box>
				)
			}

			// Show result content for completed tools (both say and ask), or file path for pending asks
			const contentLines = toolInfo.result?.trim()
				? formatToolResult(toolInfo.result, 5)
				: (isToolAsk || isToolSay) && filePath
					? [filePath as string]
					: []

			return (
				<Box flexDirection="column" marginBottom={1} width="100%">
					<DotRow color={toolColor}>
						<ToolCallText args={toolInfo.args} isAsk={isToolAsk} mode={mode} toolName={toolInfo.toolName} />
					</DotRow>
					{contentLines.length > 0 && (
						<Box flexDirection="column" marginLeft={2} width="100%">
							{contentLines.map((line, idx) => (
								<ResultRow isFirst={idx === 0} key={idx}>
									<Text color="gray">{line}</Text>
								</ResultRow>
							))}
						</Box>
					)}
				</Box>
			)
		}
		// Fallback for unparseable tool messages
		if (isToolSay) {
			return (
				<Box flexDirection="column" marginBottom={1} width="100%">
					<DotRow color={toolColor}>
						<Text color={toolColor}>{truncate(text, 100)}</Text>
					</DotRow>
				</Box>
			)
		}
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
						<Text>{truncate(command, 120)}</Text>
					</Text>
				</DotRow>
				{output && (
					<Box flexDirection="column" marginLeft={2} width="100%">
						{formatToolResult(output, 8).map((line, idx) => (
							<ResultRow isFirst={idx === 0} key={idx}>
								<Text color="gray">{line}</Text>
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
							<Text color="gray">{line}</Text>
						</ResultRow>
					))}
				</Box>
			</Box>
		)
	}

	// MCP approval (ask) or acknowledgment (say)
	if ((type === "ask" && ask === "use_mcp_server") || say === "use_mcp_server") {
		const isAsk = type === "ask"
		const parsed = text
			? jsonParseSafe<ClineAskUseMcpServer>(text, {
					type: undefined as ClineAskUseMcpServer["type"] | undefined,
					serverName: "unknown server",
					toolName: undefined as string | undefined,
					arguments: undefined as string | undefined,
					uri: undefined as string | undefined,
				})
			: undefined

		const serverName = parsed?.serverName || "unknown server"
		const actionLabel = isAsk ? "Cline wants to use MCP" : "Cline used MCP"
		const targetLine =
			parsed?.type === "access_mcp_resource"
				? `resource: ${parsed?.uri || "unknown"}`
				: parsed?.type === "use_mcp_tool"
					? `tool: ${parsed?.toolName || "unknown"}`
					: "tool: unknown"

		let argsLines: string[] = []
		if (parsed?.arguments && parsed.arguments.trim() && parsed.arguments !== "{}") {
			let formattedArgs = parsed.arguments
			try {
				formattedArgs = JSON.stringify(JSON.parse(parsed.arguments), null, 2)
			} catch {
				// Keep raw string if not valid JSON
			}
			argsLines = formatToolResult(formattedArgs, 10)
		}

		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color={toolColor}>
					<Text>
						<Text color={toolColor}>{actionLabel}</Text>
						<Text>{`: ${serverName}`}</Text>
					</Text>
				</DotRow>
				<Box flexDirection="column" marginLeft={2} width="100%">
					<ResultRow isFirst>
						<Text color="gray">{targetLine}</Text>
					</ResultRow>
					{argsLines.length > 0 && (
						<Box flexDirection="column" paddingLeft={3} width="100%">
							<Text color="gray">args:</Text>
							{argsLines.map((line, idx) => (
								<Text color="gray" key={`mcp-args-${idx}`}>
									{line}
								</Text>
							))}
						</Box>
					)}
				</Box>
			</Box>
		)
	}

	// MCP response
	if (say === "mcp_server_response" && text) {
		const lines = formatToolResult(text, 8)
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color={toolColor}>
					<Text color={toolColor}>MCP response</Text>
				</DotRow>
				<Box flexDirection="column" marginLeft={2} width="100%">
					{lines.map((line, idx) => (
						<ResultRow isFirst={idx === 0} key={idx}>
							<Text color="gray">{line}</Text>
						</ResultRow>
					))}
				</Box>
			</Box>
		)
	}

	// Error messages
	if (say === "clineignore_error") {
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color="red">
					<Text color="red" wrap="wrap">
						Cline tried to access <Text bold>{text}</Text> which is blocked by the .clineignore file.
					</Text>
				</DotRow>
			</Box>
		)
	}

	if (say === "error" || (type === "ask" && ask === "api_req_failed")) {
		// Try to parse error message if it's JSON
		let errorMessage = text || "Unknown error"
		if (text) {
			const parsed = jsonParseSafe(text, { message: undefined as string | undefined })
			if (parsed.message) {
				errorMessage = parsed.message
			}
		}

		// Check for Cline auth error to show sign-in instructions
		const isClineAuthError = errorMessage.includes(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE)

		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color="red">
					<Text color="red" wrap="wrap">
						<Text bold>Error</Text>: {errorMessage}
					</Text>
				</DotRow>
				{isClineAuthError && (
					<Box marginLeft={2} marginTop={1}>
						<Text color="gray">
							Run <Text color="cyan">/settings</Text> and go to Account to sign in.
						</Text>
					</Box>
				)}
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

	// MCP notifications
	if (say === "mcp_notification" && text) {
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color={toolColor}>
					<Text>
						<Text color={toolColor}>MCP Notification</Text>
						<Text>: {truncate(text, 120)}</Text>
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
									<Text color={isSelected ? "green" : toolColor} key={opt}>
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

	// Act mode response (non-blocking progress update)
	if (type === "ask" && ask === "act_mode_respond" && text) {
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color={toolColor}>
					<MarkdownText color={toolColor}>{text}</MarkdownText>
				</DotRow>
			</Box>
		)
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

	// Mistake limit reached (ask)
	if (type === "ask" && ask === "mistake_limit_reached") {
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color="red">
					<Text color="red" wrap="wrap">
						<Text bold>Error</Text>: {text || "Mistake limit reached."}
					</Text>
				</DotRow>
			</Box>
		)
	}

	// New task request from assistant
	if (type === "ask" && ask === "new_task" && text) {
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color={COLORS.primaryBlue}>
					<Text bold color={COLORS.primaryBlue}>
						Cline wants to start a new task:
					</Text>
				</DotRow>
				<Box flexDirection="column" paddingLeft={2}>
					<Text color="gray">{text}</Text>
				</Box>
			</Box>
		)
	}

	// Condense conversation request
	if (type === "ask" && ask === "condense" && text) {
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color={COLORS.primaryBlue}>
					<Text bold color={COLORS.primaryBlue}>
						Cline wants to condense your conversation:
					</Text>
				</DotRow>
				<Box flexDirection="column" paddingLeft={2}>
					<Text color="gray">{text}</Text>
				</Box>
			</Box>
		)
	}

	// Summarize task request
	if (type === "ask" && ask === "summarize_task" && text) {
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color={COLORS.primaryBlue}>
					<Text bold color={COLORS.primaryBlue}>
						Cline wants to summarize the task:
					</Text>
				</DotRow>
				<Box flexDirection="column" paddingLeft={2}>
					<Text color="gray">{text}</Text>
				</Box>
			</Box>
		)
	}

	// Report bug request
	if (type === "ask" && ask === "report_bug" && text) {
		return (
			<Box flexDirection="column" marginBottom={1} width="100%">
				<DotRow color={COLORS.primaryBlue}>
					<Text bold color={COLORS.primaryBlue}>
						Cline wants to create a Github issue:
					</Text>
				</DotRow>
				<Box flexDirection="column" paddingLeft={2}>
					<Text color="gray">{text}</Text>
				</Box>
			</Box>
		)
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

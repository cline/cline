/**
 * Individual message row component
 * Renders a single ClineMessage based on its type
 */

import type { ClineAsk, ClineMessage, ClineSay } from "@shared/ExtensionMessage"
import { Box, Text } from "ink"
import React from "react"
import { jsonParseSafe } from "../utils"

interface MessageRowProps {
	message: ClineMessage
	verbose?: boolean
}

/**
 * Get emoji icon for message type
 */
export function getCliMessagePrefixIcon(message: ClineMessage): string {
	if (message.type === "ask") {
		switch (message.ask) {
			case "followup":
				return "❓"
			case "command":
			case "command_output":
				return "⚙️"
			case "tool":
				return "🔧"
			case "completion_result":
				return "✅"
			case "api_req_failed":
				return "❌"
			case "resume_task":
			case "resume_completed_task":
				return "▶️"
			case "browser_action_launch":
				return "🌐"
			case "use_mcp_server":
				return "🔌"
			case "plan_mode_respond":
				return "📋"
			default:
				return "❔"
		}
	} else {
		switch (message.say) {
			case "task":
				return "📋"
			case "error":
				return "❌"
			case "text":
				return "💬"
			case "reasoning":
				return "🧠"
			case "completion_result":
				return "✅"
			case "user_feedback":
				return "👤"
			case "command":
			case "command_output":
				return "⚙️"
			case "tool":
				return "🔧"
			case "browser_action":
			case "browser_action_launch":
			case "browser_action_result":
				return "🌐"
			case "mcp_server_request_started":
			case "mcp_server_response":
				return "🔌"
			case "api_req_started":
			case "api_req_finished":
				return "🔄"
			case "checkpoint_created":
				return "💾"
			case "info":
				return "ℹ️"
			case "generate_explanation":
				return "📝"
			default:
				return "  "
		}
	}
}

/**
 * Format timestamp
 */
function formatTimestamp(ts: number): string {
	const date = new Date(ts)
	return date.toLocaleTimeString("en-US", {
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	})
}

/**
 * Render ask message based on type
 */
const AskMessageContent: React.FC<{ message: ClineMessage; verbose?: boolean }> = ({ message, verbose }) => {
	const ask = message.ask as ClineAsk
	const text = message.text || ""

	switch (ask) {
		case "followup":
		case "plan_mode_respond": {
			const parts = jsonParseSafe(text, {
				response: undefined as string | undefined,
				question: undefined as string | undefined,
			})

			if (parts.question) {
				return (
					<Text>
						<Text color="cyan"> Question:</Text> {parts.question}
					</Text>
				)
			}
			if (parts.response) {
				return (
					<Text>
						<Text color="cyan">[{ask}]</Text> {parts.response}
					</Text>
				)
			}
			return null
		}

		case "command":
			return (
				<Text>
					<Text color="magenta"> Execute command?</Text> <Text dimColor>{text}</Text>
				</Text>
			)

		case "tool":
			return (
				<Text>
					<Text color="blue"> Use tool?</Text> {text}
				</Text>
			)

		case "completion_result":
			return (
				<Text>
					<Text color="green"> Task completed</Text> {text ? `- ${text}` : ""}
				</Text>
			)

		case "api_req_failed":
			return (
				<Text>
					<Text color="red"> API request failed</Text> {text}
				</Text>
			)

		case "resume_task":
		case "resume_completed_task":
			return (
				<Text>
					<Text color="cyan"> Resume task?</Text> {text}
				</Text>
			)

		case "browser_action_launch":
			return (
				<Text>
					<Text color="cyan"> Launch browser?</Text> {text}
				</Text>
			)

		case "use_mcp_server":
			return (
				<Text>
					<Text color="cyan"> Use MCP server?</Text> {text}
				</Text>
			)

		default:
			return verbose ? (
				<Text>
					<Text color="gray">[ASK:{ask}]</Text> {text}
				</Text>
			) : null
	}
}

/**
 * Render say message based on type
 */
const SayMessageContent: React.FC<{ message: ClineMessage; verbose?: boolean }> = ({ message, verbose }) => {
	const say = message.say as ClineSay
	const text = message.text || ""

	switch (say) {
		case "task":
			return (
				<Text bold>
					<Text color="white">Task:</Text> {text}
				</Text>
			)

		case "text":
			return <Text>{text}</Text>

		case "reasoning":
			return verbose ? (
				<Text dimColor>
					<Text italic>Thinking:</Text> {text}
				</Text>
			) : null

		case "error":
			return (
				<Text color="red">
					<Text bold>Error:</Text> {text}
				</Text>
			)

		case "completion_result":
			return (
				<Text color="green">
					<Text bold>Completed:</Text> {text}
				</Text>
			)

		case "user_feedback":
			return (
				<Text>
					<Text color="green">User:</Text> {text}
				</Text>
			)

		case "command":
			return (
				<Text>
					<Text color="magenta">Command:</Text> <Text dimColor>{text}</Text>
				</Text>
			)

		case "command_output": {
			const lines = text.split("\n")
			const displayLines = lines.slice(0, 10)
			return (
				<Box flexDirection="column">
					<Text dimColor>Output:</Text>
					{displayLines.map((line, idx) => (
						<Text dimColor key={idx}>
							{line}
						</Text>
					))}
					{lines.length > 10 && <Text dimColor> ... and {lines.length - 10} more lines</Text>}
				</Box>
			)
		}

		case "tool":
			return (
				<Text>
					<Text color="blue">{text}</Text>
				</Text>
			)

		case "api_req_started":
			return verbose ? <Text color="gray">API request started</Text> : null

		case "api_req_finished":
			return null

		case "checkpoint_created":
			return <Text dimColor>Checkpoint created</Text>

		case "info":
			return <Text color="cyan">{text}</Text>

		case "browser_action":
		case "browser_action_launch":
			return (
				<Text>
					<Text color="cyan">Browser:</Text> {text}
				</Text>
			)

		case "browser_action_result":
			return <Text dimColor>Browser result {text ? `- ${text.substring(0, 100)}...` : ""}</Text>

		case "mcp_server_request_started":
			return <Text color="cyan">MCP request started {text}</Text>

		case "mcp_server_response":
			return <Text color="cyan">MCP response {text ? text.substring(0, 200) : ""}</Text>

		default:
			return verbose ? (
				<Text dimColor>
					[SAY:{say}] {text}
				</Text>
			) : null
	}
}

export const MessageRow: React.FC<MessageRowProps> = ({ message, verbose = false }) => {
	const icon = getCliMessagePrefixIcon(message)
	const timestamp = formatTimestamp(message.ts)

	// Don't render silent messages
	if (message.say === "api_req_finished" || message.say === "api_req_started") {
		return null
	}

	if (message.say === "text" && message.text?.trim() === "") {
		return null
	}

	return (
		<Box flexDirection="column">
			<Box>
				<Text dimColor>{timestamp} </Text>
				<Text>{icon} </Text>
				{message.type === "ask" ? (
					<AskMessageContent message={message} verbose={verbose} />
				) : (
					<SayMessageContent message={message} verbose={verbose} />
				)}
			</Box>
		</Box>
	)
}

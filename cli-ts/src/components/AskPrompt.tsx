/**
 * User input prompt component
 * Handles different types of user interactions (text input, confirmations, choices)
 */

import type { ClineAsk } from "@shared/ExtensionMessage"
import { Box, Text, useInput } from "ink"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { useTaskController } from "../context/TaskContext"
import { useLastCompletedAskMessage } from "../hooks/useStateSubscriber"
import { jsonParseSafe } from "../utils"

interface AskPromptProps {
	onRespond?: (response: string) => void
}

type PromptType = "confirmation" | "text" | "options" | "none"

function getPromptType(ask: ClineAsk, text: string): PromptType {
	switch (ask) {
		case "followup":
		case "plan_mode_respond": {
			const parts = jsonParseSafe(text, {
				question: undefined as string | undefined,
				options: undefined as string[] | undefined,
			})
			if (parts.options && parts.options.length > 0) {
				return "options"
			}
			// These types always need a text response
			return "text"
		}
		case "command":
		case "tool":
		case "completion_result":
		case "resume_task":
		case "resume_completed_task":
		case "browser_action_launch":
		case "use_mcp_server":
			return "confirmation"
		default:
			return "none"
	}
}

export const AskPrompt: React.FC<AskPromptProps> = ({ onRespond }) => {
	const controller = useTaskController()
	const lastAskMessage = useLastCompletedAskMessage()
	const [textInput, setTextInput] = useState("")
	const [responded, setResponded] = useState(false)
	const lastAskTs = useRef<number | null>(null)

	// Reset state when ask message changes
	useEffect(() => {
		if (lastAskMessage && lastAskMessage.ts !== lastAskTs.current) {
			lastAskTs.current = lastAskMessage.ts
			setTextInput("")
			setResponded(false)
		}
	}, [lastAskMessage])

	const sendResponse = useCallback(
		async (responseType: string, text?: string) => {
			if (responded || !controller?.task) {
				return
			}
			setResponded(true)
			try {
				await controller.task.handleWebviewAskResponse(responseType, text)
				onRespond?.(text || responseType)
			} catch {
				// Controller may be disposed
			}
		},
		[controller, responded, onRespond],
	)

	// Handle keyboard input
	useInput(
		(input, key) => {
			if (!lastAskMessage || responded) {
				return
			}

			const ask = lastAskMessage.ask as ClineAsk
			const text = lastAskMessage.text || ""
			const promptType = getPromptType(ask, text)

			if (promptType === "confirmation") {
				// y/n confirmation
				if (input.toLowerCase() === "y") {
					sendResponse("yesButtonClicked")
				} else if (input.toLowerCase() === "n") {
					sendResponse("noButtonClicked")
				}
			} else if (promptType === "options") {
				// Number selection for options
				const parts = jsonParseSafe(text, { options: [] as string[] })
				const num = parseInt(input, 10)
				if (!Number.isNaN(num) && num >= 1 && num <= parts.options.length) {
					const selectedOption = parts.options[num - 1]
					sendResponse("optionSelected", selectedOption)
				}
			} else if (promptType === "text") {
				// Text input mode
				if (key.return) {
					// Submit on Enter
					if (textInput.trim()) {
						sendResponse("messageResponse", textInput.trim())
					}
				} else if (key.backspace || key.delete) {
					setTextInput((prev) => prev.slice(0, -1))
				} else if (input && !key.ctrl && !key.meta) {
					// Regular character input
					setTextInput((prev) => prev + input)
				}
			}
		},
		{ isActive: !!lastAskMessage && !responded },
	)

	if (!lastAskMessage || responded) {
		return null
	}

	const ask = lastAskMessage.ask as ClineAsk
	const text = lastAskMessage.text || ""
	const promptType = getPromptType(ask, text)

	if (promptType === "none") {
		return null
	}

	switch (ask) {
		case "followup":
		case "plan_mode_respond": {
			const parts = jsonParseSafe(text, {
				question: undefined as string | undefined,
				options: undefined as string[] | undefined,
			})

			if (parts.options && parts.options.length > 0) {
				return (
					<Box flexDirection="column" marginTop={1}>
						<Text color="cyan">Select an option (enter number):</Text>
						{parts.options.map((opt, idx) => (
							<Box key={idx} marginLeft={2}>
								<Text>{`${idx + 1}. ${opt}`}</Text>
							</Box>
						))}
					</Box>
				)
			}

			// Text input prompt
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text color="cyan">Reply: </Text>
						<Text>{textInput}</Text>
						<Text color="gray">▌</Text>
					</Box>
					<Text color="gray" dimColor>
						(Type your response and press Enter)
					</Text>
				</Box>
			)
		}

		case "command":
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text color="yellow">⚙️ Execute this command? </Text>
						<Text color="gray">(y/n)</Text>
					</Box>
				</Box>
			)

		case "tool":
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text color="blue">🔧 Use this tool? </Text>
						<Text color="gray">(y/n)</Text>
					</Box>
				</Box>
			)

		case "completion_result":
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text color="green">✅ Task completed. Confirm? </Text>
						<Text color="gray">(y/n)</Text>
					</Box>
				</Box>
			)

		case "resume_task":
		case "resume_completed_task":
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text color="cyan">▶️ Resume task? </Text>
						<Text color="gray">(y/n)</Text>
					</Box>
				</Box>
			)

		case "browser_action_launch":
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text color="cyan">🌐 Launch browser? </Text>
						<Text color="gray">(y/n)</Text>
					</Box>
				</Box>
			)

		case "use_mcp_server":
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text color="cyan">🔌 Use MCP server? </Text>
						<Text color="gray">(y/n)</Text>
					</Box>
				</Box>
			)

		default:
			return null
	}
}

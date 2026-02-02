/**
 * User input prompt component
 * Handles different types of user interactions (text input, confirmations, choices)
 */

import type { ClineAsk } from "@shared/ExtensionMessage"
import { Box, Text, useApp, useInput } from "ink"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { useStdinContext } from "../context/StdinContext"
import { useTaskController } from "../context/TaskContext"
import { useLastCompletedAskMessage } from "../hooks/useStateSubscriber"
import { isMouseEscapeSequence } from "../utils/input"
import { jsonParseSafe } from "../utils/parser"
import { getCliMessagePrefixIcon } from "./MessageRow"

interface AskPromptProps {
	onRespond?: (response: string) => void
}

type PromptType = "confirmation" | "text" | "options" | "plan_mode_text" | "completion" | "exit_confirmation" | "none"

function getPromptType(ask: ClineAsk, text: string): PromptType {
	switch (ask) {
		case "followup": {
			const parts = jsonParseSafe(text, {
				question: undefined as string | undefined,
				options: undefined as string[] | undefined,
			})
			if (parts.options && parts.options.length > 0) {
				return "options"
			}
			return "text"
		}
		case "plan_mode_respond": {
			const parts = jsonParseSafe(text, {
				question: undefined as string | undefined,
				options: undefined as string[] | undefined,
			})
			if (parts.options && parts.options.length > 0) {
				return "options"
			}
			// Plan mode without options - allow text input or toggle to Act mode
			return "plan_mode_text"
		}
		case "completion_result":
			// Task completed - allow follow-up question or exit
			return "completion"

		case "resume_task":
		case "resume_completed_task":
			return "exit_confirmation"

		case "command":
		case "tool":
		case "browser_action_launch":
		case "use_mcp_server":
			return "confirmation"
		default:
			return "none"
	}
}

export const AskPrompt: React.FC<AskPromptProps> = ({ onRespond }) => {
	const { exit } = useApp()
	const { isRawModeSupported } = useStdinContext()
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

	const toggleToActMode = useCallback(async () => {
		if (responded || !controller) {
			return
		}
		setResponded(true)
		try {
			await controller.togglePlanActMode("act")
			onRespond?.("Switched to Act mode")
		} catch {
			// Controller may be disposed
		}
	}, [controller, responded, onRespond])

	// Handle keyboard input
	useInput(
		(input, key) => {
			// Filter out mouse escape sequences
			if (isMouseEscapeSequence(input)) {
				return
			}

			if (!lastAskMessage || responded) {
				return
			}

			const ask = lastAskMessage.ask as ClineAsk
			const text = lastAskMessage.text || ""
			const promptType = getPromptType(ask, text)

			if (promptType === "confirmation" || promptType === "exit_confirmation") {
				// y/n confirmation
				if (input.toLowerCase() === "y") {
					sendResponse("yesButtonClicked")
				} else if (input.toLowerCase() === "n") {
					if (promptType === "exit_confirmation") {
						exit()
						return
					}
					sendResponse("noButtonClicked")
				}
			} else if (promptType === "options") {
				// Number selection for options, or free text input
				const parts = jsonParseSafe(text, { options: [] as string[] })
				if (key.return) {
					// Submit free text on Enter
					if (textInput.trim()) {
						sendResponse("messageResponse", textInput.trim())
					}
				} else if (key.backspace || key.delete) {
					setTextInput((prev) => prev.slice(0, -1))
				} else if (input && !key.ctrl && !key.meta) {
					// Check if it's a number for option selection (only when no text typed yet)
					const num = parseInt(input, 10)
					if (textInput === "" && !Number.isNaN(num) && num >= 1 && num <= parts.options.length) {
						const selectedOption = parts.options[num - 1]
						sendResponse("messageResponse", selectedOption)
					} else {
						// Regular character input for free text
						setTextInput((prev) => prev + input)
					}
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
			} else if (promptType === "plan_mode_text") {
				// Plan mode text input - allows text response or toggle to Act mode
				if (key.return) {
					// Submit on Enter
					if (textInput.trim()) {
						sendResponse("messageResponse", textInput.trim())
					} else {
						// Empty enter = switch to Act mode
						toggleToActMode()
					}
				} else if (key.backspace || key.delete) {
					setTextInput((prev) => prev.slice(0, -1))
				} else if (input && !key.ctrl && !key.meta) {
					// Regular character input
					setTextInput((prev) => prev + input)
				}
			} else if (promptType === "completion") {
				// Task completed - allow follow-up question or exit
				if (key.return) {
					if (textInput.trim()) {
						// Send follow-up question
						sendResponse("messageResponse", textInput.trim())
					} else {
						// Empty enter = confirm completion (exit)
						sendResponse("yesButtonClicked")
					}
				} else if (key.backspace || key.delete) {
					setTextInput((prev) => prev.slice(0, -1))
				} else if (input && !key.ctrl && !key.meta) {
					// Regular character input
					setTextInput((prev) => prev + input)
				}
			}
		},
		{ isActive: isRawModeSupported && !!lastAskMessage && !responded },
	)

	if (!lastAskMessage || responded) {
		return null
	}

	const ask = lastAskMessage.ask as ClineAsk
	const text = lastAskMessage.text || ""
	const promptType = getPromptType(ask, text)
	const icon = getCliMessagePrefixIcon(lastAskMessage)

	if (promptType === "none") {
		return null
	}

	switch (ask) {
		case "followup": {
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
						<Box marginTop={1}>
							<Text>{icon} </Text>
							<Text color="cyan">Or type: </Text>
							<Text>{textInput}</Text>
							<Text inverse> </Text>
						</Box>
						<Text color="gray">(Enter number to select, or type response + Enter)</Text>
					</Box>
				)
			}

			// Text input prompt
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text>{icon} </Text>
						<Text color="cyan">Reply: </Text>
						<Text>{textInput}</Text>
						<Text inverse> </Text>
					</Box>
					<Text color="gray">(Type your response and press Enter)</Text>
				</Box>
			)
		}

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
						<Box marginTop={1}>
							<Text>{icon} </Text>
							<Text color="cyan">Or type: </Text>
							<Text>{textInput}</Text>
							<Text inverse> </Text>
						</Box>
						<Text color="gray">(Enter number to select, or type response + Enter)</Text>
					</Box>
				)
			}

			// Plan mode text input - show option to switch to Act mode
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text>{icon} </Text>
						<Text color="cyan">Reply: </Text>
						<Text>{textInput}</Text>
						<Text inverse> </Text>
					</Box>
					<Text color="gray">(Type response + Enter, or just Enter to switch to Act mode)</Text>
				</Box>
			)
		}

		case "command":
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text>{icon} </Text>
						<Text color="yellow"> Execute this command? </Text>
						<Text color="gray">(y/n)</Text>
					</Box>
				</Box>
			)

		case "tool":
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text>{icon} </Text>
						<Text color="blue"> Use this tool? </Text>
						<Text color="gray">(y/n)</Text>
					</Box>
				</Box>
			)

		case "completion_result":
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text>{icon} </Text>
						<Text color="cyan">Follow-up: </Text>
						<Text>{textInput}</Text>
						<Text inverse> </Text>
					</Box>
					<Text color="gray">(Type follow-up question + Enter, or q to exit)</Text>
				</Box>
			)

		case "resume_task":
		case "resume_completed_task":
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text>{icon} </Text>
						<Text color="cyan"> Resume task? </Text>
						<Text color="gray">(y/n)</Text>
					</Box>
				</Box>
			)

		case "browser_action_launch":
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text>{icon} </Text>
						<Text color="cyan"> Launch browser? </Text>
						<Text color="gray">(y/n)</Text>
					</Box>
				</Box>
			)

		case "use_mcp_server":
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text>{icon} </Text>
						<Text color="cyan"> Use MCP server? </Text>
						<Text color="gray">(y/n)</Text>
					</Box>
				</Box>
			)

		default:
			return null
	}
}

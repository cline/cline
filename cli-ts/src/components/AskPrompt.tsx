/**
 * User input prompt component
 * Handles different types of user interactions (text input, confirmations, choices)
 */

import type { ClineAsk } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import { Box, Text, useApp, useInput } from "ink"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { StateManager } from "@/core/storage/StateManager"
import { getProviderDefaultModelId } from "@/shared/storage"
import { useStdinContext } from "../context/StdinContext"
import { useTaskController } from "../context/TaskContext"
import { useLastCompletedAskMessage } from "../hooks/useStateSubscriber"
import { jsonParseSafe } from "../utils/parser"
import { getCliMessagePrefixIcon } from "./MessageRow"
import { PromptInput } from "./PromptInput"

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

	const [mode, setMode] = useState<Mode>(() => {
		const stateManager = StateManager.get()
		return stateManager.getGlobalSettingsKey("mode") || "act"
	})

	const toggleMode = useCallback(() => {
		const newMode: Mode = mode === "act" ? "plan" : "act"
		setMode(newMode)
		const stateManager = StateManager.get()
		stateManager.setGlobalState("mode", newMode)
	}, [mode])

	const provider = useMemo(() => {
		const stateManager = StateManager.get()
		const currentMode = stateManager.getGlobalSettingsKey("mode") as string
		const providerKey = currentMode === "act" ? "actModeApiProvider" : "planModeApiProvider"
		const currentProvider = stateManager.getGlobalSettingsKey(providerKey) as string
		return currentProvider || "cline"
	}, [])

	const modelId = useMemo(() => {
		const stateManager = StateManager.get()
		const modelKey = mode === "act" ? "actModeApiModelId" : "planModeApiModelId"
		return (stateManager.getGlobalSettingsKey(modelKey) as string) || getProviderDefaultModelId(provider)
	}, [mode, provider])

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
			// Tab toggles mode regardless of prompt state
			if (key.tab) {
				toggleMode()
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
						sendResponse("optionSelected", selectedOption)
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
				if (input.toLowerCase() === "q" && textInput === "") {
					// 'q' with no text typed = exit
					sendResponse("yesButtonClicked")
				} else if (key.return) {
					if (textInput.trim()) {
						// Send follow-up question
						sendResponse("messageResponse", textInput.trim())
					}
					// Empty enter = do nothing (user must type 'q' to exit or type a follow-up)
				} else if (key.backspace || key.delete) {
					setTextInput((prev) => prev.slice(0, -1))
				} else if (input && !key.ctrl && !key.meta) {
					// Regular character input
					setTextInput((prev) => prev + input)
				}
			}
		},
		{ isActive: isRawModeSupported },
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

	// Helper to render options list above input
	const renderOptions = (options: string[]) => (
		<Box flexDirection="column" marginBottom={1}>
			<Text color="cyan">Select an option (enter number):</Text>
			{options.map((opt, idx) => (
				<Box key={idx} marginLeft={2}>
					<Text>{`${idx + 1}. ${opt}`}</Text>
				</Box>
			))}
		</Box>
	)

	switch (ask) {
		case "followup": {
			const parts = jsonParseSafe(text, {
				question: undefined as string | undefined,
				options: undefined as string[] | undefined,
			})

			if (parts.options && parts.options.length > 0) {
				return (
					<Box flexDirection="column" marginTop={1}>
						{renderOptions(parts.options)}
						<PromptInput
							helpText="(Enter number to select, or type response + Enter)"
							mode={mode}
							modelId={modelId || ""}
							question={
								<React.Fragment>
									<Text>{icon} </Text>
									<Text color="cyan">Or type:</Text>
								</React.Fragment>
							}
							textInput={textInput}
						/>
					</Box>
				)
			}

			// Text input prompt
			return (
				<PromptInput
					helpText="(Type your response and press Enter)"
					mode={mode}
					modelId={modelId || ""}
					question={
						<React.Fragment>
							<Text>{icon} </Text>
							<Text color="cyan">Reply:</Text>
						</React.Fragment>
					}
					textInput={textInput}
				/>
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
						{renderOptions(parts.options)}
						<PromptInput
							helpText="(Enter number to select, or type response + Enter)"
							mode={mode}
							modelId={modelId || ""}
							question={
								<React.Fragment>
									<Text>{icon} </Text>
									<Text color="cyan">Or type:</Text>
								</React.Fragment>
							}
							textInput={textInput}
						/>
					</Box>
				)
			}

			// Plan mode text input - show option to switch to Act mode
			return (
				<PromptInput
					helpText="(Type response + Enter, or just Enter to switch to Act mode)"
					mode={mode}
					modelId={modelId || ""}
					question={
						<React.Fragment>
							<Text>{icon} </Text>
							<Text color="cyan">Reply:</Text>
						</React.Fragment>
					}
					textInput={textInput}
				/>
			)
		}

		case "command":
			return (
				<PromptInput
					helpText="(y/n)"
					mode={mode}
					modelId={modelId || ""}
					question={
						<React.Fragment>
							<Text>{icon} </Text>
							<Text color="yellow">Execute this command?</Text>
						</React.Fragment>
					}
					questionColor="yellow"
					textInput={textInput}
				/>
			)

		case "tool":
			return (
				<PromptInput
					helpText="(y/n)"
					mode={mode}
					modelId={modelId || ""}
					question={
						<React.Fragment>
							<Text>{icon} </Text>
							<Text color="blue">Use this tool?</Text>
						</React.Fragment>
					}
					questionColor="blue"
					textInput={textInput}
				/>
			)

		case "completion_result":
			return (
				<PromptInput
					helpText="(Type follow-up question + Enter, or q to exit)"
					mode={mode}
					modelId={modelId || ""}
					question={
						<React.Fragment>
							<Text>{icon} </Text>
							<Text color="cyan">Follow-up:</Text>
						</React.Fragment>
					}
					textInput={textInput}
				/>
			)

		case "resume_task":
		case "resume_completed_task":
			return (
				<PromptInput
					helpText="(y/n)"
					mode={mode}
					modelId={modelId || ""}
					question={
						<React.Fragment>
							<Text>{icon} </Text>
							<Text color="cyan">Resume task?</Text>
						</React.Fragment>
					}
					textInput={textInput}
				/>
			)

		case "browser_action_launch":
			return (
				<PromptInput
					helpText="(y/n)"
					mode={mode}
					modelId={modelId || ""}
					question={
						<React.Fragment>
							<Text>{icon} </Text>
							<Text color="cyan">Launch browser?</Text>
						</React.Fragment>
					}
					textInput={textInput}
				/>
			)

		case "use_mcp_server":
			return (
				<PromptInput
					helpText="(y/n)"
					mode={mode}
					modelId={modelId || ""}
					question={
						<React.Fragment>
							<Text>{icon} </Text>
							<Text color="cyan">Use MCP server?</Text>
						</React.Fragment>
					}
					textInput={textInput}
				/>
			)

		default:
			return null
	}
}

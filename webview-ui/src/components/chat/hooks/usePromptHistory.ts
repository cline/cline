import { ClineMessage, HistoryItem } from "@roo-code/types"
import { useCallback, useEffect, useMemo, useState } from "react"

interface UsePromptHistoryProps {
	clineMessages: ClineMessage[] | undefined
	taskHistory: HistoryItem[] | undefined
	cwd: string | undefined
	inputValue: string
	setInputValue: (value: string) => void
}

interface CursorPositionState {
	value: string
	afterRender?: "SET_CURSOR_FIRST_LINE" | "SET_CURSOR_LAST_LINE" | "SET_CURSOR_START"
}

export interface UsePromptHistoryReturn {
	historyIndex: number
	setHistoryIndex: (index: number) => void
	tempInput: string
	setTempInput: (input: string) => void
	promptHistory: string[]
	inputValueWithCursor: CursorPositionState
	setInputValueWithCursor: (state: CursorPositionState) => void
	handleHistoryNavigation: (
		event: React.KeyboardEvent<HTMLTextAreaElement>,
		showContextMenu: boolean,
		isComposing: boolean,
	) => boolean
	resetHistoryNavigation: () => void
	resetOnInputChange: () => void
}

export const usePromptHistory = ({
	clineMessages,
	taskHistory,
	cwd,
	inputValue,
	setInputValue,
}: UsePromptHistoryProps): UsePromptHistoryReturn => {
	// Maximum number of prompts to keep in history for memory management
	const MAX_PROMPT_HISTORY_SIZE = 100

	// Prompt history navigation state
	const [historyIndex, setHistoryIndex] = useState(-1)
	const [tempInput, setTempInput] = useState("")
	const [promptHistory, setPromptHistory] = useState<string[]>([])
	const [inputValueWithCursor, setInputValueWithCursor] = useState<CursorPositionState>({ value: inputValue })

	// Initialize prompt history with hybrid approach: conversation messages if in task, otherwise task history
	const filteredPromptHistory = useMemo(() => {
		// First try to get conversation messages (user_feedback from clineMessages)
		const conversationPrompts = clineMessages
			?.filter((message) => {
				// Filter for user_feedback messages that have text content
				return (
					message.type === "say" &&
					message.say === "user_feedback" &&
					message.text &&
					message.text.trim() !== ""
				)
			})
			.map((message) => message.text!)

		// If we have conversation messages, use those (newest first when navigating up)
		if (conversationPrompts && conversationPrompts.length > 0) {
			return conversationPrompts.slice(-MAX_PROMPT_HISTORY_SIZE).reverse() // newest first for conversation messages
		}

		// If we have clineMessages array (meaning we're in an active task), don't fall back to task history
		// Only use task history when starting fresh (no active conversation)
		if (clineMessages && clineMessages.length > 0) {
			return []
		}

		// Fall back to task history only when starting fresh (no active conversation)
		if (!taskHistory || taskHistory.length === 0 || !cwd) {
			return []
		}

		// Extract user prompts from task history for the current workspace only
		const taskPrompts = taskHistory
			.filter((item) => {
				// Filter by workspace and ensure task is not empty
				return item.task && item.task.trim() !== "" && (!item.workspace || item.workspace === cwd)
			})
			.map((item) => item.task)
			.slice(0, MAX_PROMPT_HISTORY_SIZE)

		return taskPrompts
	}, [clineMessages, taskHistory, cwd])

	// Update prompt history when filtered history changes and reset navigation
	useEffect(() => {
		setPromptHistory(filteredPromptHistory)
		// Reset navigation state when switching between history sources
		setHistoryIndex(-1)
		setTempInput("")
	}, [filteredPromptHistory])

	// Reset history navigation when user types (but not when we're setting it programmatically)
	const resetOnInputChange = useCallback(() => {
		if (historyIndex !== -1) {
			setHistoryIndex(-1)
			setTempInput("")
		}
	}, [historyIndex])

	const handleHistoryNavigation = useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>, showContextMenu: boolean, isComposing: boolean): boolean => {
			// Handle prompt history navigation
			if (!showContextMenu && promptHistory.length > 0 && !isComposing) {
				const textarea = event.currentTarget
				const { selectionStart, selectionEnd, value } = textarea
				const lines = value.substring(0, selectionStart).split("\n")
				const currentLineIndex = lines.length - 1
				const totalLines = value.split("\n").length
				const isAtFirstLine = currentLineIndex === 0
				const isAtLastLine = currentLineIndex === totalLines - 1
				const hasSelection = selectionStart !== selectionEnd

				// Only navigate history if cursor is at first/last line and no text is selected
				if (!hasSelection) {
					if (event.key === "ArrowUp" && isAtFirstLine) {
						event.preventDefault()

						// Save current input if starting navigation
						if (historyIndex === -1 && inputValue.trim() !== "") {
							setTempInput(inputValue)
						}

						// Navigate to previous prompt
						const newIndex = historyIndex + 1
						if (newIndex < promptHistory.length) {
							setHistoryIndex(newIndex)
							const historicalPrompt = promptHistory[newIndex]
							if (historicalPrompt) {
								setInputValue(historicalPrompt)
								setInputValueWithCursor({
									value: historicalPrompt,
									afterRender: "SET_CURSOR_FIRST_LINE",
								})
							}
						}
						return true
					}

					if (event.key === "ArrowDown" && isAtLastLine) {
						event.preventDefault()

						// Navigate to next prompt
						if (historyIndex > 0) {
							const newIndex = historyIndex - 1
							setHistoryIndex(newIndex)
							const historicalPrompt = promptHistory[newIndex]
							if (historicalPrompt) {
								setInputValue(historicalPrompt)
								setInputValueWithCursor({
									value: historicalPrompt,
									afterRender: "SET_CURSOR_LAST_LINE",
								})
							}
						} else if (historyIndex === 0) {
							// Return to current input
							setHistoryIndex(-1)
							setInputValue(tempInput)
							setInputValueWithCursor({
								value: tempInput,
								afterRender: "SET_CURSOR_START",
							})
						}
						return true
					}
				}
			}
			return false
		},
		[promptHistory, historyIndex, inputValue, tempInput, setInputValue],
	)

	const resetHistoryNavigation = useCallback(() => {
		setHistoryIndex(-1)
		setTempInput("")
	}, [])

	return {
		historyIndex,
		setHistoryIndex,
		tempInput,
		setTempInput,
		promptHistory,
		inputValueWithCursor,
		setInputValueWithCursor,
		handleHistoryNavigation,
		resetHistoryNavigation,
		resetOnInputChange,
	}
}

import { useCallback, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"

const MAX_HISTORY_ITEMS = 20

/**
 * Hook for navigating prompt history using up/down arrow keys.
 * Extracts unique prompts from taskHistory (most recent first).
 */
export function usePromptHistory() {
	const { taskHistory } = useExtensionState()
	const [historyIndex, setHistoryIndex] = useState(-1) // -1 = not browsing history
	const savedInputRef = useRef("") // Save user's input when entering history mode

	const getHistoryItems = useCallback((): string[] => {
		if (!taskHistory?.length) return []
		const filtered = [...new Set(
			[...taskHistory]
				.reverse()
				.map((item) => item.task)
				.filter(Boolean) as string[]
		)].slice(0, MAX_HISTORY_ITEMS)
		return filtered
	}, [taskHistory])

	const navigateUp = useCallback(
		(currentInput: string): { text: string; handled: boolean } => {
			const historyItems = getHistoryItems()
			if (historyItems.length === 0) return { text: currentInput, handled: false }

			const canNavigate =
				currentInput === "" ||
				(historyIndex >= 0 && historyIndex < historyItems.length && currentInput === historyItems[historyIndex])

			if (!canNavigate) return { text: currentInput, handled: false }

			// Save original input when first entering history mode
			if (historyIndex === -1) {
				savedInputRef.current = currentInput
			}

			const newIndex = Math.min(historyIndex + 1, historyItems.length - 1)
			if (newIndex === historyIndex) return { text: currentInput, handled: false }

			setHistoryIndex(newIndex)
			return { text: historyItems[newIndex], handled: true }
		},
		[getHistoryItems, historyIndex],
	)

	const navigateDown = useCallback(
		(currentInput: string): { text: string; handled: boolean } => {
			const historyItems = getHistoryItems()
			if (historyIndex < 0) return { text: currentInput, handled: false }

			const canNavigate = historyIndex < historyItems.length && currentInput === historyItems[historyIndex]
			if (!canNavigate) return { text: currentInput, handled: false }

			const newIndex = historyIndex - 1
			if (newIndex >= 0) {
				setHistoryIndex(newIndex)
				return { text: historyItems[newIndex], handled: true }
			}

			// Exit history mode, restore saved input
			setHistoryIndex(-1)
			return { text: savedInputRef.current, handled: true }
		},
		[getHistoryItems, historyIndex],
	)

	const resetHistory = useCallback(() => {
		setHistoryIndex(-1)
		savedInputRef.current = ""
	}, [])

	return { navigateUp, navigateDown, resetHistory, historyIndex }
}

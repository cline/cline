import { ClineMessage, QueuedMessage } from "@shared/ExtensionMessage"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChatState } from "../types/chatTypes"

/**
 * Custom hook for managing chat state
 * Handles input values, selection states, and UI state
 */
export function useChatState(messages: ClineMessage[]): ChatState {
	// Input and selection state
	const [inputValue, setInputValue] = useState("")
	const [activeQuote, setActiveQuote] = useState<string | null>(null)
	const [isTextAreaFocused, setIsTextAreaFocused] = useState(false)
	const [selectedImages, setSelectedImages] = useState<string[]>([])
	const [selectedFiles, setSelectedFiles] = useState<string[]>([])

	// UI state
	const [sendingDisabled, setSendingDisabled] = useState(false)
	const [enableButtons, setEnableButtons] = useState<boolean>(false)
	const [primaryButtonText, setPrimaryButtonText] = useState<string | undefined>("Approve")
	const [secondaryButtonText, setSecondaryButtonText] = useState<string | undefined>("Reject")
	const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})

	// Message queue state
	const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([])

	// Refs
	const textAreaRef = useRef<HTMLTextAreaElement>(null)

	// Derived state
	const lastMessage = useMemo(() => messages.at(-1), [messages])
	const secondLastMessage = useMemo(() => messages.at(-2), [messages])
	const clineAsk = useMemo(() => (lastMessage?.type === "ask" ? lastMessage.ask : undefined), [lastMessage])

	// Clear expanded rows when task changes
	const task = useMemo(() => messages.at(0), [messages])
	const clearExpandedRows = useCallback(() => {
		setExpandedRows({})
	}, [])

	// Track previous task timestamp to detect genuinely new tasks
	const prevTaskTsRef = useRef<number | undefined>(undefined)

	// Reset state when starting new conversation
	const resetState = useCallback(() => {
		setInputValue("")
		setActiveQuote(null)
		setSelectedImages([])
		setSelectedFiles([])
		setMessageQueue([])
	}, [])

	// Handle focus change
	const handleFocusChange = useCallback((isFocused: boolean) => {
		setIsTextAreaFocused(isFocused)
	}, [])

	// Clear message queue when a NEW task starts
	// This handles: undefined → Task B, Task A → Task B
	// Does NOT clear on: Task A → Task A (mode switch), undefined → undefined (no task)
	useEffect(() => {
		const currentTaskTs = task?.ts
		const prevTaskTs = prevTaskTsRef.current

		console.log("[CANCEL_FLOW] [useChatState] Task change detected:", {
			currentTaskTs,
			prevTaskTs,
			willClearQueue: currentTaskTs !== undefined && prevTaskTs !== currentTaskTs,
		})

		// Clear queue if we have a CURRENT task AND it's different from prev
		// This works for: cancel → new task (undefined → 2000) and direct switch (1000 → 2000)
		if (currentTaskTs !== undefined && prevTaskTs !== currentTaskTs) {
			console.log("[CANCEL_FLOW] [useChatState] Clearing message queue due to new task")
			setMessageQueue([])
		}

		// Always update ref to track task changes
		prevTaskTsRef.current = currentTaskTs

		clearExpandedRows()
	}, [task?.ts, clearExpandedRows])

	return {
		// State values
		inputValue,
		setInputValue,
		activeQuote,
		setActiveQuote,
		isTextAreaFocused,
		setIsTextAreaFocused,
		selectedImages,
		setSelectedImages,
		selectedFiles,
		setSelectedFiles,
		sendingDisabled,
		setSendingDisabled,
		enableButtons,
		setEnableButtons,
		primaryButtonText,
		setPrimaryButtonText,
		secondaryButtonText,
		setSecondaryButtonText,
		expandedRows,
		setExpandedRows,

		// Message queue state
		messageQueue,
		setMessageQueue,

		// Refs
		textAreaRef,

		// Derived values
		lastMessage,
		secondLastMessage,
		clineAsk,
		task,

		// Handlers
		handleFocusChange,
		clearExpandedRows,
		resetState,
	}
}

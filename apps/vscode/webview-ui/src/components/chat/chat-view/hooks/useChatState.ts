import { ClineMessage } from "@shared/ExtensionMessage"
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChatState, type DraftSnapshot, PendingResponse, PendingUserMessage } from "../types/chatTypes"

const EMPTY_DRAFT: DraftSnapshot = {
	revision: 0,
	text: "",
	activeQuote: null,
	images: [],
	files: [],
}

function applyDraftFieldUpdate<Key extends "text" | "activeQuote" | "images" | "files">(
	draft: DraftSnapshot,
	key: Key,
	update: SetStateAction<DraftSnapshot[Key]>,
): DraftSnapshot {
	const value = typeof update === "function" ? update(draft[key]) : update
	return { ...draft, revision: draft.revision + 1, [key]: value }
}

/**
 * Custom hook for managing chat state
 * Handles input values, selection states, and UI state
 */
export function useChatState(messages: ClineMessage[]): ChatState {
	// Input and selection state
	const [draft, setDraft] = useState(EMPTY_DRAFT)
	const draftRef = useRef(draft)
	const updateDraft = useCallback((update: (current: DraftSnapshot) => DraftSnapshot) => {
		const next = update(draftRef.current)
		draftRef.current = next
		setDraft(next)
	}, [])
	const setInputValue = useCallback<Dispatch<SetStateAction<string>>>(
		(update) => updateDraft((current) => applyDraftFieldUpdate(current, "text", update)),
		[updateDraft],
	)
	const setActiveQuote = useCallback<Dispatch<SetStateAction<string | null>>>(
		(update) => updateDraft((current) => applyDraftFieldUpdate(current, "activeQuote", update)),
		[updateDraft],
	)
	const setSelectedImages = useCallback<Dispatch<SetStateAction<string[]>>>(
		(update) => updateDraft((current) => applyDraftFieldUpdate(current, "images", update)),
		[updateDraft],
	)
	const setSelectedFiles = useCallback<Dispatch<SetStateAction<string[]>>>(
		(update) => updateDraft((current) => applyDraftFieldUpdate(current, "files", update)),
		[updateDraft],
	)
	const [isTextAreaFocused, setIsTextAreaFocused] = useState(false)
	const getDraftSnapshot = useCallback((): DraftSnapshot => draftRef.current, [])
	const consumeDraftSnapshot = useCallback(
		(submitted: DraftSnapshot) => {
			// A submission takes effect at acknowledgement. Clear the whole draft
			// only if no draft mutation crossed that await boundary.
			updateDraft((current) =>
				current.revision === submitted.revision ? { ...EMPTY_DRAFT, revision: current.revision + 1 } : current,
			)
		},
		[updateDraft],
	)

	// UI state
	const [sendingDisabled, setSendingDisabled] = useState(false)
	const [enableButtons, setEnableButtons] = useState<boolean>(false)
	const [primaryButtonText, setPrimaryButtonText] = useState<string | undefined>("Approve")
	const [secondaryButtonText, setSecondaryButtonText] = useState<string | undefined>("Reject")
	const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})
	const [pendingUserMessage, setPendingUserMessage] = useState<PendingUserMessage | undefined>(undefined)
	const [pendingResponse, setPendingResponse] = useState<PendingResponse | undefined>(undefined)

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

	// Reset state when starting new conversation
	const resetState = useCallback(() => {
		setInputValue("")
		setActiveQuote(null)
		setSelectedImages([])
		setSelectedFiles([])
	}, [setInputValue, setActiveQuote, setSelectedImages, setSelectedFiles])

	// Handle focus change
	const handleFocusChange = useCallback((isFocused: boolean) => {
		setIsTextAreaFocused(isFocused)
	}, [])

	// Auto-expand last message row when task or messages first changed.
	useEffect(() => {
		clearExpandedRows()
	}, [task?.ts, clearExpandedRows])

	return {
		// State values
		inputValue: draft.text,
		setInputValue,
		activeQuote: draft.activeQuote,
		setActiveQuote,
		isTextAreaFocused,
		setIsTextAreaFocused,
		selectedImages: draft.images,
		setSelectedImages,
		selectedFiles: draft.files,
		setSelectedFiles,
		getDraftSnapshot,
		consumeDraftSnapshot,
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
		pendingUserMessage,
		setPendingUserMessage,
		pendingResponse,
		setPendingResponse,

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

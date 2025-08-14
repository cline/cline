/**
 * Shared types and interfaces for the chat view components
 */

import { ClineMessage, ClineAsk } from "@shared/ExtensionMessage"
import { VirtuosoHandle } from "react-virtuoso"

/**
 * Main ChatView component props
 */
export interface ChatViewProps {
	isHidden: boolean
	showAnnouncement: boolean
	hideAnnouncement: () => void
	showHistoryView: () => void
}

/**
 * Chat state interface
 */
export interface ChatState {
	// State values
	inputValue: string
	setInputValue: React.Dispatch<React.SetStateAction<string>>
	activeQuote: string | null
	setActiveQuote: React.Dispatch<React.SetStateAction<string | null>>
	isTextAreaFocused: boolean
	setIsTextAreaFocused: React.Dispatch<React.SetStateAction<boolean>>
	selectedImages: string[]
	setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>
	selectedFiles: string[]
	setSelectedFiles: React.Dispatch<React.SetStateAction<string[]>>
	sendingDisabled: boolean
	setSendingDisabled: React.Dispatch<React.SetStateAction<boolean>>
	enableButtons: boolean
	setEnableButtons: React.Dispatch<React.SetStateAction<boolean>>
	primaryButtonText: string | undefined
	setPrimaryButtonText: React.Dispatch<React.SetStateAction<string | undefined>>
	secondaryButtonText: string | undefined
	setSecondaryButtonText: React.Dispatch<React.SetStateAction<string | undefined>>
	expandedRows: Record<number, boolean>
	setExpandedRows: React.Dispatch<React.SetStateAction<Record<number, boolean>>>

	// Refs
	textAreaRef: React.RefObject<HTMLTextAreaElement>

	// Derived values
	lastMessage: ClineMessage | undefined
	secondLastMessage: ClineMessage | undefined
	clineAsk: ClineAsk | undefined
	task: ClineMessage | undefined

	// Handlers
	handleFocusChange: (isFocused: boolean) => void
	clearExpandedRows: () => void
	resetState: () => void

	// Scroll-related state (will be moved to scroll hook)
	showScrollToBottom?: boolean
	isAtBottom?: boolean
	pendingScrollToMessage?: number | null
}

/**
 * Message handlers interface
 */
export interface MessageHandlers {
	handleSendMessage: (text: string, images: string[], files: string[]) => Promise<void>
	handleButtonClick: (action: string, text?: string, images?: string[], files?: string[]) => Promise<void>
	handleTaskCloseButtonClick: () => void
	startNewTask: () => Promise<void>
}

/**
 * Scroll behavior interface
 */
export interface ScrollBehavior {
	virtuosoRef: React.RefObject<VirtuosoHandle>
	scrollContainerRef: React.RefObject<HTMLDivElement>
	disableAutoScrollRef: React.MutableRefObject<boolean>
	scrollToBottomSmooth: () => void
	scrollToBottomAuto: () => void
	scrollToMessage: (messageIndex: number) => void
	toggleRowExpansion: (ts: number) => void
	handleRowHeightChange: (isTaller: boolean) => void
	showScrollToBottom: boolean
	setShowScrollToBottom: React.Dispatch<React.SetStateAction<boolean>>
	isAtBottom: boolean
	setIsAtBottom: React.Dispatch<React.SetStateAction<boolean>>
	pendingScrollToMessage: number | null
	setPendingScrollToMessage: React.Dispatch<React.SetStateAction<number | null>>
}

/**
 * Button state interface
 */
export interface ButtonState {
	enableButtons: boolean
	primaryButtonText: string | undefined
	secondaryButtonText: string | undefined
}

/**
 * Input state interface
 */
export interface InputState {
	inputValue: string
	selectedImages: string[]
	selectedFiles: string[]
	activeQuote: string | null
	isTextAreaFocused: boolean
}

/**
 * Task section props
 */
export interface TaskSectionProps {
	task: ClineMessage
	messages: ClineMessage[]
	scrollBehavior: ScrollBehavior
	buttonState: ButtonState
	messageHandlers: MessageHandlers
	chatState: ChatState
	apiMetrics: {
		totalTokensIn: number
		totalTokensOut: number
		totalCacheWrites?: number
		totalCacheReads?: number
		totalCost: number
	}
	lastApiReqTotalTokens?: number
	selectedModelInfo: {
		supportsPromptCache: boolean
		supportsImages: boolean
	}
	isStreaming: boolean
	clineAsk?: ClineAsk
	modifiedMessages: ClineMessage[]
}

/**
 * Welcome section props
 */
export interface WelcomeSectionProps {
	showAnnouncement: boolean
	hideAnnouncement: () => void
	showHistoryView: () => void
	telemetrySetting: string
	version: string
	taskHistory: any[]
	shouldShowQuickWins: boolean
}

/**
 * Input section props
 */
export interface InputSectionProps {
	chatState: ChatState
	messageHandlers: MessageHandlers
	textAreaRef: React.RefObject<HTMLTextAreaElement>
	onFocusChange: (isFocused: boolean) => void
	onInputChange: (value: string) => void
	onQuoteChange: (quote: string | null) => void
	onImagesChange: (images: string[]) => void
	onFilesChange: (files: string[]) => void
	placeholderText: string
	shouldDisableFilesAndImages: boolean
	selectFilesAndImages: () => Promise<void>
}

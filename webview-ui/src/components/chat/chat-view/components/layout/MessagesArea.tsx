import { ClineMessage } from "@shared/ExtensionMessage"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import React, { useCallback, useMemo } from "react"
import { Virtuoso } from "react-virtuoso"
import { StickyUserMessage } from "@/components/chat/task-header/StickyUserMessage"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"
import { createMessageRenderer } from "../messages/MessageRenderer"

interface MessagesAreaProps {
	task: ClineMessage
	groupedMessages: (ClineMessage | ClineMessage[])[]
	modifiedMessages: ClineMessage[]
	scrollBehavior: ScrollBehavior
	chatState: ChatState
	messageHandlers: MessageHandlers
	isReasoningActive?: boolean
	isWaitingForContent?: boolean
	streamingReasoningContent?: string
	supportsStreaming?: boolean
}

/**
 * The scrollable messages area with virtualized list
 * Handles rendering of chat rows and browser sessions
 */
export const MessagesArea: React.FC<MessagesAreaProps> = ({
	task,
	groupedMessages,
	modifiedMessages,
	scrollBehavior,
	chatState,
	messageHandlers,
	isReasoningActive,
	isWaitingForContent,
	streamingReasoningContent,
	supportsStreaming,
}) => {
	const { clineMessages } = useExtensionState()
	const [isStreamingReasoningExpanded, setIsStreamingReasoningExpanded] = React.useState(true)
	const reasoningScrollRef = React.useRef<HTMLDivElement>(null)
	const rafPendingRef = React.useRef(false)

	// Auto-scroll reasoning content to bottom as it streams.
	// Uses a pending-RAF guard so rapid content updates coalesce into a single
	// scroll-to-bottom per frame instead of queuing redundant callbacks that
	// could race with DOM updates during fast streams.
	React.useEffect(() => {
		if (reasoningScrollRef.current && streamingReasoningContent && isStreamingReasoningExpanded) {
			if (!rafPendingRef.current) {
				rafPendingRef.current = true
				requestAnimationFrame(() => {
					rafPendingRef.current = false
					const scrollElement = reasoningScrollRef.current
					if (scrollElement) {
						scrollElement.scrollTop = scrollElement.scrollHeight
					}
				})
			}
		}
	}, [streamingReasoningContent, isStreamingReasoningExpanded])

	const {
		virtuosoRef,
		scrollContainerRef,
		toggleRowExpansion,
		handleRowHeightChange,
		setIsAtBottom,
		setShowScrollToBottom,
		disableAutoScrollRef,
		handleRangeChanged,
		scrolledPastUserMessage,
		scrollToMessage,
	} = scrollBehavior

	// Find the index of the scrolled past user message for scrolling
	const scrolledPastUserMessageIndex = useMemo(() => {
		if (!scrolledPastUserMessage) {
			return -1
		}
		return clineMessages.findIndex((msg) => msg.ts === scrolledPastUserMessage.ts)
	}, [clineMessages, scrolledPastUserMessage])

	// Handler to scroll to the scrolled past user message
	const handleScrollToUserMessage = useCallback(() => {
		if (scrollToMessage && scrolledPastUserMessageIndex >= 0) {
			scrollToMessage(scrolledPastUserMessageIndex)
		}
	}, [scrollToMessage, scrolledPastUserMessageIndex])

	const { expandedRows, inputValue, setActiveQuote } = chatState

	const itemContent = useCallback(
		createMessageRenderer(
			groupedMessages,
			modifiedMessages,
			expandedRows,
			toggleRowExpansion,
			handleRowHeightChange,
			setActiveQuote,
			inputValue,
			messageHandlers,
			!!(isWaitingForContent || isReasoningActive),
		),
		[
			groupedMessages,
			modifiedMessages,
			expandedRows,
			toggleRowExpansion,
			handleRowHeightChange,
			setActiveQuote,
			inputValue,
			messageHandlers,
			isWaitingForContent,
			isReasoningActive,
		],
	)

	return (
		<div className="overflow-hidden flex flex-col h-full relative">
			{/* Sticky User Message - positioned absolutely to avoid layout shifts */}
			<div
				className={cn(
					"absolute top-0 left-0 right-0 z-10 pl-[15px] pr-[14px] bg-background",
					scrolledPastUserMessage && "pb-2",
				)}>
				<StickyUserMessage
					isVisible={!!scrolledPastUserMessage}
					lastUserMessage={scrolledPastUserMessage}
					onScrollToMessage={handleScrollToUserMessage}
				/>
			</div>

			<div className="grow flex" ref={scrollContainerRef}>
				<Virtuoso
					atBottomStateChange={(isAtBottom) => {
						setIsAtBottom(isAtBottom)
						if (isAtBottom) {
							disableAutoScrollRef.current = false
						}
						setShowScrollToBottom(disableAutoScrollRef.current && !isAtBottom)
					}}
					atBottomThreshold={10} // trick to make sure virtuoso re-renders when task changes, and we use initialTopMostItemIndex to start at the bottom
					className="scrollable grow overflow-y-scroll"
					components={{
						Footer: () => (
							<div>
								{/* Show "Working..." at bottom of chat stream.
								    "Thinking..." is now rendered inline in RequestStartRow to keep it
								    anchored to the request row and avoid visual jumps during followup
								    question streaming when options grow the row. */}
								{isWaitingForContent && (
									<div className="pl-[16px] pt-2.5">
										{/* Non-streaming models: just shimmer text */}
										{(supportsStreaming === false || !streamingReasoningContent) && (
											<div className="inline-flex justify-baseline gap-0.5 text-left select-none px-0 w-full">
												<span className="animate-shimmer bg-linear-90 from-foreground to-description bg-[length:200%_100%] bg-clip-text text-transparent">
													{isWaitingForContent ? "Working..." : "Thinking..."}
												</span>
											</div>
										)}

										{/* Streaming models with reasoning: show expandable content */}
										{supportsStreaming !== false && streamingReasoningContent && (
											<div className="mb-1">
												<button
													className="inline-flex items-center justify-baseline gap-0.5 text-left select-none cursor-pointer px-0 w-full bg-transparent border-0"
													onClick={() => setIsStreamingReasoningExpanded(!isStreamingReasoningExpanded)}
													type="button">
													<span className="animate-shimmer bg-linear-90 from-foreground to-description bg-[length:200%_100%] bg-clip-text text-transparent">
														Thinking...
													</span>
													{isStreamingReasoningExpanded ? (
														<ChevronDownIcon className="size-1 ml-1 text-foreground" />
													) : (
														<ChevronRightIcon className="size-1 ml-1 text-foreground" />
													)}
												</button>
												{isStreamingReasoningExpanded && (
													<div
														className="mt-1 max-h-[75px] overflow-y-auto text-description text-sm leading-normal whitespace-pre-wrap break-words pl-2 border-l border-description/50"
														ref={reasoningScrollRef}
														// column-reverse keeps content anchored at bottom as it streams in
														// Combined with scrollTop = scrollHeight, this ensures latest content is visible
														style={{ display: "flex", flexDirection: "column-reverse" }}>
														<span className="block">{streamingReasoningContent}</span>
													</div>
												)}
											</div>
										)}
									</div>
								)}
								<div className="min-h-1" />
							</div>
						),
					}}
					data={groupedMessages}
					// increasing top by 3_000 to prevent jumping around when user collapses a row
					increaseViewportBy={{
						top: 3_000,
						bottom: Number.MAX_SAFE_INTEGER,
					}} // hack to make sure the last message is always rendered to get truly perfect scroll to bottom animation when new messages are added (Number.MAX_SAFE_INTEGER is safe for arithmetic operations, which is all virtuoso uses this value for in src/sizeRangeSystem.ts)
					initialTopMostItemIndex={groupedMessages.length - 1} // messages is the raw format returned by extension, modifiedMessages is the manipulated structure that combines certain messages of related type, and visibleMessages is the filtered structure that removes messages that should not be rendered
					itemContent={itemContent}
					key={task.ts}
					rangeChanged={handleRangeChanged}
					ref={virtuosoRef} // anything lower causes issues with followOutput
					style={{
						scrollbarWidth: "none", // Firefox
						msOverflowStyle: "none", // IE/Edge
						overflowAnchor: "none", // prevent scroll jump when content expands
					}}
				/>
			</div>
		</div>
	)
}

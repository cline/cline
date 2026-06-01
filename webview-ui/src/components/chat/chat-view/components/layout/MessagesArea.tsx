import { AiHydroMessage } from "@shared/ExtensionMessage"
import React, { useCallback, useMemo } from "react"
import { Virtuoso } from "react-virtuoso"
import TypingIndicator from "@/components/chat/TypingIndicator"
import { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"
import { createMessageRenderer } from "../messages/MessageRenderer"

interface MessagesAreaProps {
	task: AiHydroMessage
	groupedMessages: (AiHydroMessage | AiHydroMessage[])[]
	modifiedMessages: AiHydroMessage[]
	scrollBehavior: ScrollBehavior
	chatState: ChatState
	messageHandlers: MessageHandlers
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
}) => {
	const {
		virtuosoRef,
		scrollContainerRef,
		toggleRowExpansion,
		handleRowHeightChange,
		setIsAtBottom,
		setShowScrollToBottom,
		disableAutoScrollRef,
		isAtBottom,
		scrollToBottomSmooth,
	} = scrollBehavior

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
		],
	)

	// Show typing indicator when the last message is from the user (no assistant response yet)
	// Also show when an API request has started but the assistant hasn't started responding
	const showTypingIndicator = useMemo(() => {
		if (groupedMessages.length === 0) {
			return false
		}
		const last = groupedMessages[groupedMessages.length - 1]
		if (Array.isArray(last)) {
			return false
		}
		// User messages are type "ask" with ask === "user_feedback"
		if (last.type === "ask" && last.ask === "user_feedback") {
			return true
		}
		// API request started but no text response yet
		if (last.type === "say" && last.say === "api_req_started") {
			return true
		}
		return false
	}, [groupedMessages])

	return (
		<div className="overflow-hidden flex flex-col h-full relative">
			{/* Floating jump-to-latest button (Claude Code style): appears whenever the user is
			    not pinned to the bottom, overlaid on the transcript so it never displaces the
			    approve/reject action buttons. */}
			{!isAtBottom && groupedMessages.length > 0 && (
				<button
					aria-label="Scroll to latest"
					className="absolute bottom-3 right-4 z-10 flex items-center justify-center w-8 h-8 rounded-full shadow-md smooth-transition active:scale-[0.92] cursor-pointer border-0"
					onClick={() => {
						scrollToBottomSmooth()
						disableAutoScrollRef.current = false
					}}
					style={{
						background: "var(--vscode-button-secondaryBackground)",
						color: "var(--vscode-button-secondaryForeground)",
					}}>
					<span className="codicon codicon-chevron-down text-[14px]" />
				</button>
			)}
			<div className="flex-grow flex" ref={scrollContainerRef}>
				<Virtuoso
					atBottomStateChange={(isAtBottom) => {
						setIsAtBottom(isAtBottom)
						if (isAtBottom) {
							disableAutoScrollRef.current = false
						}
						setShowScrollToBottom(disableAutoScrollRef.current && !isAtBottom)
					}}
					atBottomThreshold={10} // trick to make sure virtuoso re-renders when task changes, and we use initialTopMostItemIndex to start at the bottom
					className="scrollable"
					components={{
						Footer: () => (
							<div>
								{showTypingIndicator && <TypingIndicator />}
								<div style={{ height: 5 }} />
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
					ref={virtuosoRef} // anything lower causes issues with followOutput
					style={{
						flexGrow: 1,
						overflowY: "scroll", // always show scrollbar
					}}
				/>
			</div>
		</div>
	)
}

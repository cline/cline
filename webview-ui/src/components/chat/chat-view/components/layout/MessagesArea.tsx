import React, { useCallback } from "react"
import { Virtuoso } from "react-virtuoso"
import AutoApproveBar from "@/components/chat/auto-approve-menu/AutoApproveBar"
import { ClineMessage } from "@shared/ExtensionMessage"
import { ScrollBehavior, ChatState, MessageHandlers } from "../../types/chatTypes"
import { createMessageRenderer } from "../messages/MessageRenderer"

interface MessagesAreaProps {
	task: ClineMessage
	groupedMessages: (ClineMessage | ClineMessage[])[]
	modifiedMessages: ClineMessage[]
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

	return (
		<>
			<div style={{ flexGrow: 1, display: "flex" }} ref={scrollContainerRef}>
				<Virtuoso
					ref={virtuosoRef}
					key={task.ts} // trick to make sure virtuoso re-renders when task changes, and we use initialTopMostItemIndex to start at the bottom
					className="scrollable"
					style={{
						flexGrow: 1,
						overflowY: "scroll", // always show scrollbar
					}}
					components={{
						Footer: () => <div style={{ height: 5 }} />, // Add empty padding at the bottom
					}}
					// increasing top by 3_000 to prevent jumping around when user collapses a row
					increaseViewportBy={{
						top: 3_000,
						bottom: Number.MAX_SAFE_INTEGER,
					}} // hack to make sure the last message is always rendered to get truly perfect scroll to bottom animation when new messages are added (Number.MAX_SAFE_INTEGER is safe for arithmetic operations, which is all virtuoso uses this value for in src/sizeRangeSystem.ts)
					data={groupedMessages} // messages is the raw format returned by extension, modifiedMessages is the manipulated structure that combines certain messages of related type, and visibleMessages is the filtered structure that removes messages that should not be rendered
					itemContent={itemContent}
					atBottomStateChange={(isAtBottom) => {
						setIsAtBottom(isAtBottom)
						if (isAtBottom) {
							disableAutoScrollRef.current = false
						}
						setShowScrollToBottom(disableAutoScrollRef.current && !isAtBottom)
					}}
					atBottomThreshold={10} // anything lower causes issues with followOutput
					initialTopMostItemIndex={groupedMessages.length - 1}
				/>
			</div>
			<AutoApproveBar />
		</>
	)
}

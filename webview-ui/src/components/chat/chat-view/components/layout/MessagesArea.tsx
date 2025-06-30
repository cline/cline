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
					key={task.ts} // trick to make sure virtuoso re-renders when task changes
					className="scrollable"
					style={{
						flexGrow: 1,
						overflowY: "scroll", // always show scrollbar
					}}
					components={{
						Footer: () => <div style={{ height: 5 }} />, // Add empty padding at the bottom
					}}
					increaseViewportBy={{
						top: 3_000,
						bottom: Number.MAX_SAFE_INTEGER,
					}}
					data={groupedMessages}
					itemContent={itemContent}
					atBottomStateChange={(isAtBottom) => {
						setIsAtBottom(isAtBottom)
						if (isAtBottom) {
							disableAutoScrollRef.current = false
						}
						setShowScrollToBottom(disableAutoScrollRef.current && !isAtBottom)
					}}
					atBottomThreshold={10}
					initialTopMostItemIndex={groupedMessages.length - 1}
				/>
			</div>
			<AutoApproveBar />
		</>
	)
}

import type { ClineMessage } from "@shared/ExtensionMessage"
import type React from "react"
import { useCallback, useMemo } from "react"
import { Virtuoso } from "react-virtuoso"
import { StickyUserMessage } from "@/components/chat/task-header/StickyUserMessage"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import type { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"
import { isToolGroup } from "../../utils/messageUtils"
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
	const { clineMessages } = useExtensionState()

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
	const lastVisibleRow = useMemo(() => groupedMessages.at(-1), [groupedMessages])
	const lastVisibleMessage = useMemo(() => {
		const lastRow = lastVisibleRow
		if (!lastRow) {
			return undefined
		}
		return Array.isArray(lastRow) ? lastRow.at(-1) : lastRow
	}, [lastVisibleRow])

	// Show "Thinking..." in the Footer until real content starts streaming.
	// This is the sole early loading indicator - RequestStartRow does NOT duplicate it.
	// Covers: pre-api_req_started (backend processing) AND post-api_req_started (waiting for model).
	// Hides once reasoning, tools, text, or any other content message appears.
	const isWaitingForResponse = useMemo(() => {
		const lastRawMessage = clineMessages.at(-1)

		const lastMsg = modifiedMessages[modifiedMessages.length - 1]

		// Never show thinking while waiting on user input (any ask state).
		// This includes completion_result, tool approvals, followups, and resume asks.
		if (lastRawMessage?.type === "ask") {
			return false
		}
		// attempt_completion emits a final say("completion_result") before ask("completion_result").
		// Treat that final completion message as non-waiting to avoid a brief footer flicker.
		if (lastRawMessage?.type === "say" && lastRawMessage.say === "completion_result") {
			return false
		}
		if (lastRawMessage?.type === "say" && lastRawMessage.say === "api_req_started") {
			try {
				const info = JSON.parse(lastRawMessage.text || "{}")
				if (info.cancelReason === "user_cancelled") {
					return false
				}
			} catch {
				// ignore parse errors
			}
		}

		// Always show while task has started but no visible rows are rendered yet.
		if (groupedMessages.length === 0) {
			return true
		}

		// Defensive guard for transient states where a grouped row exists
		// but we still cannot resolve a concrete visible message.
		if (!lastVisibleMessage) {
			return true
		}

		// Always show when the last rendered row is a toolgroup.
		if (lastVisibleRow && isToolGroup(lastVisibleRow)) {
			return true
		}

		// User-requested behavior:
		// if the last visible row is not actively partial, always show Thinking in the footer.
		// (some rows like checkpoint_created don't set `partial`, and should be treated as non-partial)
		if (lastVisibleMessage.partial !== true) {
			return true
		}

		if (!lastMsg) {
			// No messages after the initial task message - new task just started
			return true
		}
		if (lastMsg.say === "user_feedback" || lastMsg.say === "user_feedback_diff") return true
		if (lastMsg.say === "api_req_started") {
			try {
				const info = JSON.parse(lastMsg.text || "{}")
				// Still in progress (no cost) and nothing has streamed after it yet
				return info.cost == null
			} catch {
				return true
			}
		}
		return false
	}, [clineMessages, groupedMessages.length, lastVisibleMessage, lastVisibleRow, modifiedMessages])

	const itemContent = useMemo(
		() =>
			createMessageRenderer(
				groupedMessages,
				modifiedMessages,
				expandedRows,
				toggleRowExpansion,
				handleRowHeightChange,
				setActiveQuote,
				inputValue,
				messageHandlers,
				isWaitingForResponse,
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
			isWaitingForResponse,
		],
	)

	// Keep Virtuoso footer component identity stable while waiting state is unchanged.
	// This avoids remounting the shimmer node on every message update.
	const virtuosoComponents = useMemo(
		() => ({
			Footer: () =>
				isWaitingForResponse ? (
					<div className="px-4 pt-2 pb-2.5">
						<div className="ml-1">
							<span className="animate-shimmer bg-linear-90 from-foreground to-description bg-[length:200%_100%] bg-clip-text text-transparent select-none">
								Thinking...
							</span>
						</div>
					</div>
				) : (
					<div className="min-h-1" />
				),
		}),
		[isWaitingForResponse],
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
					components={virtuosoComponents}
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

import type { ClineMessage } from "@shared/ExtensionMessage"
import type React from "react"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { Virtuoso } from "react-virtuoso"
import ChatRow from "@/components/chat/ChatRow"
import { StickyUserMessage } from "@/components/chat/task-header/StickyUserMessage"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { useThinkingLoaderRow } from "../../hooks/useThinkingLoaderRow"
import type { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"
import { isPendingResponseUnconfirmed } from "../../utils/pendingResponse"
import { createMessageRenderer } from "../messages/MessageRenderer"

// Sentinel ts for the synthetic "Thinking..." placeholder row. Not a real message; ignored when
// deriving scroll triggers from the tail of the rendered list.
const WAITING_ROW_TS = Number.MIN_SAFE_INTEGER

// Synthetic placeholder rendered while waiting for the model with no visible rows streaming.
const WAITING_ROW: ClineMessage = {
	ts: WAITING_ROW_TS,
	type: "say",
	say: "reasoning",
	partial: true,
	text: "",
}

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
	const { clineMessages, turnState } = useExtensionState()
	const lastRawMessage = useMemo(() => clineMessages.at(-1), [clineMessages])

	const {
		virtuosoRef,
		scrollContainerRef,
		toggleRowExpansion,
		handleRowHeightChange,
		setIsAtBottom,
		disableAutoScrollRef,
		handleRangeChanged,
		scrolledPastUserMessage,
		scrollToMessage,
		scrollToBottomSmooth,
		scrollToBottomAuto,
		handleLastRowContentChange,
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
	// A turn (new task or follow-up) was just started from this webview but the backend's
	// streaming TurnState has not round-tripped yet, so the replica's turnState is stale
	// (idle/completed/awaiting_*). Let the loader show optimistically so "Thinking..." renders
	// the moment the send happens instead of popping in after the state post.
	const forcePendingResponseLoader = isPendingResponseUnconfirmed(chatState.pendingResponse, turnState, clineMessages.length)

	// Keep loader in the message flow (not footer). Show/hide logic (waiting heuristic,
	// waiting -> reasoning handoff guard, and anti-flash debounce on turn end) lives in the hook.
	const showThinkingLoaderRow = useThinkingLoaderRow({
		turnState,
		lastRawMessage,
		groupedMessages,
		lastVisibleRow,
		lastVisibleMessage,
		modifiedMessages,
		forceShow: forcePendingResponseLoader,
	})

	// While the list has no visible rows yet (new task just submitted), the loader is rendered as
	// a plain element instead of a Virtuoso item: a cold-mounting virtualized list takes several
	// frames to measure and paint its first item, which visibly delays the "Thinking..." shimmer
	// right when the chat view appears. Once any real row exists the list is warm and the loader
	// goes back to being an in-list row (unchanged behavior).
	const showEmptyListLoader = showThinkingLoaderRow && groupedMessages.length === 0

	const displayedGroupedMessages = useMemo<(ClineMessage | ClineMessage[])[]>(() => {
		if (!showThinkingLoaderRow || showEmptyListLoader) {
			return groupedMessages
		}
		return [...groupedMessages, WAITING_ROW]
	}, [groupedMessages, showThinkingLoaderRow, showEmptyListLoader])

	// useScrollBehavior auto-scrolls when groupedMessages.length changes, but rows can change here
	// without that: the waiting row is turnState-driven (e.g. plan -> act auto-continue adds no
	// message), new tool messages merge into the trailing tool group at constant length, and the
	// waiting row gets swapped for a real reasoning row. Pin to bottom for those too, keyed on the
	// rendered list's length and the tail message's ts (stable across partial updates, so this
	// doesn't fire while a message streams; row growth is handled by ChatRow's height observer).
	const lastTailTs = useMemo(() => {
		for (let i = displayedGroupedMessages.length - 1; i >= 0; i--) {
			const row = displayedGroupedMessages[i]
			const message = Array.isArray(row) ? row.at(-1) : row
			if (message && message.ts !== WAITING_ROW_TS) {
				return message.ts
			}
		}
		return undefined
	}, [displayedGroupedMessages])

	useEffect(() => {
		if (disableAutoScrollRef.current) {
			return
		}
		scrollToBottomSmooth()
		// Settle with an instant scroll so late layout shifts can't leave us short of the bottom.
		// No cleanup: a quick follow-up change would cancel the settle scroll.
		setTimeout(() => {
			if (!disableAutoScrollRef.current) {
				scrollToBottomAuto()
			}
		}, 50)
	}, [displayedGroupedMessages.length, lastTailTs, scrollToBottomSmooth, scrollToBottomAuto, disableAutoScrollRef])

	// Re-engage auto scroll when a new turn starts streaming. In the old extension every turn start
	// came from a webview action (send, approve, resume) whose handler reset disableAutoScrollRef;
	// a turnState-driven start like plan -> act auto-continue has no webview-side action, so reset
	// it here to keep the old "new turn pins to bottom" behavior.
	const prevTurnPhaseRef = useRef(turnState?.phase)
	useEffect(() => {
		const prevPhase = prevTurnPhaseRef.current
		prevTurnPhaseRef.current = turnState?.phase
		if (turnState?.phase === "streaming" && prevPhase !== "streaming") {
			disableAutoScrollRef.current = false
			scrollToBottomSmooth()
		}
	}, [turnState?.phase, scrollToBottomSmooth, disableAutoScrollRef])

	const itemContent = useMemo(
		() =>
			createMessageRenderer(
				displayedGroupedMessages,
				modifiedMessages,
				expandedRows,
				toggleRowExpansion,
				handleRowHeightChange,
				handleLastRowContentChange,
				setActiveQuote,
				inputValue,
				messageHandlers,
				false,
			),
		[
			displayedGroupedMessages,
			modifiedMessages,
			expandedRows,
			toggleRowExpansion,
			handleRowHeightChange,
			handleLastRowContentChange,
			setActiveQuote,
			inputValue,
			messageHandlers,
		],
	)

	// Keep footer as a simple spacer. Thinking loading is rendered as an in-list row.
	const virtuosoComponents = useMemo(
		() => ({
			Footer: () => <div className="min-h-1" />,
		}),
		[],
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

			<div className="grow flex relative" ref={scrollContainerRef}>
				{/* Empty-list fast path: paint the loader immediately without waiting for the
				    virtualized list's initial measure/render cycle. Mirrors the in-list row's
				    markup (MessageRenderer wrapper + ChatRow) so the swap to a real row later
				    causes no visual jump. Virtuoso stays mounted (empty) underneath, so it is
				    already warm when the first real row arrives. */}
				{showEmptyListLoader && (
					<div className="absolute inset-0 overflow-hidden">
						<ChatRow
							inputValue={inputValue}
							isExpanded={false}
							isLast={true}
							lastModifiedMessage={modifiedMessages.at(-1)}
							message={WAITING_ROW}
							onCancelCommand={() => messageHandlers.executeButtonAction("cancel")}
							onHeightChange={handleRowHeightChange}
							onLastRowContentChange={handleLastRowContentChange}
							onSetQuote={setActiveQuote}
							onToggleExpand={toggleRowExpansion}
							sendMessageFromChatRow={messageHandlers.handleSendMessage}
						/>
					</div>
				)}
				<Virtuoso
					atBottomStateChange={(isAtBottom) => {
						setIsAtBottom(isAtBottom)
						if (isAtBottom) {
							disableAutoScrollRef.current = false
						}
					}}
					atBottomThreshold={10} // trick to make sure virtuoso re-renders when task changes, and we use initialTopMostItemIndex to start at the bottom
					className="scrollable grow overflow-y-scroll"
					components={virtuosoComponents}
					data={displayedGroupedMessages}
					// increasing top by 3_000 to prevent jumping around when user collapses a row
					increaseViewportBy={{
						top: 3_000,
						bottom: Number.MAX_SAFE_INTEGER,
					}} // hack to make sure the last message is always rendered to get truly perfect scroll to bottom animation when new messages are added (Number.MAX_SAFE_INTEGER is safe for arithmetic operations, which is all virtuoso uses this value for in src/sizeRangeSystem.ts)
					initialTopMostItemIndex={displayedGroupedMessages.length - 1} // messages is the raw format returned by extension, modifiedMessages is the manipulated structure that combines certain messages of related type, and visibleMessages is the filtered structure that removes messages that should not be rendered
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

import type { ClineMessage } from "@shared/ExtensionMessage"
import type React from "react"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { Virtuoso } from "react-virtuoso"
import { StickyUserMessage } from "@/components/chat/task-header/StickyUserMessage"
import { useMessagesState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { MessageRowContext } from "../../context/MessageRowContext"
import type { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"
import { MessageRenderer } from "../messages/MessageRenderer"

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
	// Messages are high-frequency state, published through MessagesStateContext (V12 方案3).
	const { clineMessages, turnState, messageTruncated, loadHistoryBatch, hasMoreMessages } = useMessagesState()

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

	// Show "Thinking..." until real content starts streaming.
	// This is the sole early loading indicator - RequestStartRow does NOT duplicate it.
	// Covers: pre-api_req_started (backend processing) AND post-api_req_started (waiting for model).
	// Hides once reasoning, tools, text, or any other content message appears.
	const isWaitingForResponse = useMemo(() => {
		const lastMsg = modifiedMessages[modifiedMessages.length - 1]

		// AUTHORITATIVE PATH: when the backend provides a TurnState, the agent is only "thinking"
		// while phase === "streaming". Any other phase (awaiting_approval/followup, completed,
		// error, resumable, idle) is never a thinking state — this is what makes the footer
		// immune to trailing bookkeeping messages and prevents the stuck-"Thinking" bug (RC1).
		// During streaming we still suppress the footer loader once a partial content row is
		// actually rendering, to avoid a duplicate spinner (handled by the legacy sub-logic
		// below, which only runs in the streaming case).
		if (turnState) {
			if (turnState.phase !== "streaming") {
				return false
			}
			// phase === streaming: show Thinking until a visible content row is streaming.
			if (groupedMessages.length === 0 || !lastVisibleMessage) {
				return true
			}
			// A visible row exists — check if it still needs the loading indicator.
			// The loading indicator stays visible only when the visible row is a
			// bare api_req_started — i.e. the LLM hasn't begun sending content yet.
			// Reasoning or text content means the model IS responding.
			// Use lastVisibleMessage (not modifiedMessages) since we only care about
			// the output that the user can actually see.
			if (lastVisibleMessage.say === "api_req_started") {
				return true
			}
			// Any other visible content means the model has started responding.
			return false
		}

		// LEGACY PATH (no TurnState): heuristic detection
		if (!lastMsg) {
			return false
		}
		// We're waiting if there's an api_req_started that hasn't gotten a response
		return lastMsg.say === "api_req_started"
	}, [modifiedMessages, groupedMessages.length, lastVisibleMessage, turnState])

	// Compute initialTopMostItemIndex to start scrolled to bottom
	const initialIndex = useMemo(() => {
		return Math.max(0, groupedMessages.length - 1)
	}, [groupedMessages.length])

	// Stable ref to track the latest groupedMessages length for isLast computation
	// inside the stable itemContent callback
	const groupedMessagesLengthRef = useRef(groupedMessages.length)
	groupedMessagesLengthRef.current = groupedMessages.length

	// Stable itemContent — does NOT depend on modifiedMessages or groupedMessages array ref
	// This is the P0 fix: during streaming, modifiedMessages changes on every chunk.
	// If itemContent depended on modifiedMessages, it would be a new function reference
	// on every chunk, causing Virtuoso to remount ALL visible rows.
	const itemContent = useCallback(
		(index: number, messageOrGroup: ClineMessage | ClineMessage[]) => {
			const isLast = index === groupedMessagesLengthRef.current - 1
			return <MessageRenderer index={index} isLast={isLast} messageOrGroup={messageOrGroup} />
		},
		[expandedRows, inputValue],
	)

	// ThinkingLoader rendered as Virtuoso Footer instead of synthetic data row.
	// This prevents the data array reference from changing during streaming,
	// which avoids Virtuoso rebuilding its DOM on every chunk.
	const showThinkingLoader = isWaitingForResponse
	const ThinkingLoaderFooter = useCallback(() => {
		if (!showThinkingLoader) {
			return <div className="min-h-1" />
		}
		return <div className="flex items-center justify-center py-4 text-muted-foreground text-sm">Thinking...</div>
	}, [showThinkingLoader])

	const virtuosoComponents = useMemo(
		() => ({
			Footer: ThinkingLoaderFooter,
		}),
		[ThinkingLoaderFooter],
	)

	/**
	 * Handle scroll-up (startReached): load older messages when user scrolls past
	 * the truncation window top boundary.
	 */
	const handleStartReached = useCallback(() => {
		// Only load if messages are truncated and there are more available
		if (!messageTruncated || !hasMoreMessages || !task?.ts) return

		// Get the oldest message timestamp from grouped data
		const firstRow = groupedMessages[0]
		if (!firstRow) return
		const firstMsg = Array.isArray(firstRow) ? firstRow[0] : firstRow
		const beforeTs = firstMsg?.ts
		if (!beforeTs || typeof beforeTs !== "number") return

		loadHistoryBatch(task.ts, beforeTs)
	}, [messageTruncated, hasMoreMessages, task, groupedMessages, loadHistoryBatch])

	// Build the context value for MessageRowContext.Provider
	const messageRowContextValue = useMemo(
		() => ({
			modifiedMessages,
			groupedMessages,
			messageHandlers,
			expandedRows,
			inputValue,
			footerActive: false,
			onToggleExpand: toggleRowExpansion,
			onHeightChange: handleRowHeightChange,
			onLastRowContentChange: handleLastRowContentChange,
			onSetQuote: setActiveQuote,
		}),
		[
			modifiedMessages,
			groupedMessages,
			messageHandlers,
			expandedRows,
			inputValue,
			toggleRowExpansion,
			handleRowHeightChange,
			handleLastRowContentChange,
			setActiveQuote,
		],
	)

	// When a new turn starts streaming, pin to bottom.
	const prevTurnPhaseRef = useRef(turnState?.phase)
	useEffect(() => {
		const prevPhase = prevTurnPhaseRef.current
		prevTurnPhaseRef.current = turnState?.phase
		if (turnState?.phase === "streaming" && prevPhase !== "streaming") {
			disableAutoScrollRef.current = false
			scrollToBottomSmooth()
		}
	}, [turnState?.phase, scrollToBottomSmooth, disableAutoScrollRef])

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
				<MessageRowContext.Provider value={messageRowContextValue}>
					<Virtuoso
						atBottomStateChange={(isAtBottom) => {
							setIsAtBottom(isAtBottom)
							if (isAtBottom) {
								disableAutoScrollRef.current = false
							}
						}}
						atBottomThreshold={10}
						className="scrollable grow overflow-y-scroll"
						components={virtuosoComponents}
						data={groupedMessages}
						increaseViewportBy={{
							top: 500,
							bottom: 300,
						}}
						initialTopMostItemIndex={initialIndex}
						itemContent={itemContent}
						key={task.ts}
						rangeChanged={handleRangeChanged}
						ref={virtuosoRef}
						startReached={handleStartReached}
						style={{
							scrollbarWidth: "none", // Firefox
							msOverflowStyle: "none", // IE/Edge
							overflowAnchor: "none", // prevent scroll jump when content expands
						}}
					/>
				</MessageRowContext.Provider>
			</div>
		</div>
	)
}

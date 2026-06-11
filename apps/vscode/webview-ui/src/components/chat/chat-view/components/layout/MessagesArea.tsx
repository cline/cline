import type { ClineMessage } from "@shared/ExtensionMessage"
import type React from "react"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { Virtuoso } from "react-virtuoso"
import { StickyUserMessage } from "@/components/chat/task-header/StickyUserMessage"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import type { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"
import { isToolGroup } from "../../utils/messageUtils"
import { createMessageRenderer } from "../messages/MessageRenderer"

// Sentinel ts for the synthetic "Thinking..." placeholder row. Not a real message; ignored when
// deriving scroll triggers from the tail of the rendered list.
const WAITING_ROW_TS = Number.MIN_SAFE_INTEGER

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
		setShowScrollToBottom,
		disableAutoScrollRef,
		handleRangeChanged,
		scrolledPastUserMessage,
		scrollToMessage,
		scrollToBottomSmooth,
		scrollToBottomAuto,
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
			if (lastVisibleRow && isToolGroup(lastVisibleRow)) {
				return true
			}
			return lastVisibleMessage.partial !== true
		}

		// LEGACY PATH (no TurnState — classic/older state): infer from the message tail.
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
	}, [turnState, lastRawMessage, groupedMessages.length, lastVisibleMessage, lastVisibleRow, modifiedMessages])

	// Keep loader in the message flow (not footer). During handoff from waiting -> reasoning stream,
	// keep the loader mounted until a real reasoning row is visible.
	const showThinkingLoaderRow = useMemo(() => {
		const handoffToReasoningPending =
			lastRawMessage?.type === "say" &&
			lastRawMessage.say === "reasoning" &&
			lastRawMessage.partial === true &&
			lastVisibleMessage?.say !== "reasoning"

		// Mirror the old footer behavior exactly: show whenever waiting logic says so.
		// Plus a brief handoff guard while grouped rows catch up to raw reasoning stream.
		return isWaitingForResponse || handoffToReasoningPending
	}, [isWaitingForResponse, lastRawMessage, lastVisibleMessage?.say])

	const displayedGroupedMessages = useMemo<(ClineMessage | ClineMessage[])[]>(() => {
		if (!showThinkingLoaderRow) {
			return groupedMessages
		}
		const waitingRow: ClineMessage = {
			ts: WAITING_ROW_TS,
			type: "say",
			say: "reasoning",
			partial: true,
			text: "",
		}
		return [...groupedMessages, waitingRow]
	}, [groupedMessages, showThinkingLoaderRow])

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

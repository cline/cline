import type { ClineMessage } from "@shared/ExtensionMessage"
import type React from "react"
import { useCallback, useMemo } from "react"
import BrowserSessionRow from "@/components/chat/BrowserSessionRow"
import ChatRow from "@/components/chat/ChatRow"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import type { MessageHandlers } from "../../types/chatTypes"
import { type ActivityGroup, type ChatListItem, getGroupHeadMessage, isActivityGroup } from "../../utils/activityFolding"
import { findReasoningForApiReq, isToolGroup } from "../../utils/messageUtils"
import { ActivityGroupRenderer } from "./ActivityGroupRenderer"
import { ToolGroupRenderer } from "./ToolGroupRenderer"

interface MessageRendererProps {
	index: number
	messageOrGroup: ClineMessage | ClineMessage[]
	groupedMessages: (ClineMessage | ClineMessage[])[]
	modifiedMessages: ClineMessage[]
	expandedRows: Record<number, boolean>
	onToggleExpand: (ts: number, options?: { preserveAutoScroll?: boolean; next?: boolean }) => void
	onHeightChange: (isTaller: boolean) => void
	onLastRowContentChange: () => void
	onSetQuote: (quote: string | null) => void
	inputValue: string
	messageHandlers: MessageHandlers
	footerActive: boolean
	/**
	 * Overrides the "tail of the rendered list" detection for rows nested inside an activity
	 * fold, where the top-level index does not apply.
	 */
	isLastItem?: boolean
	/** Same override, for tool groups nested inside an activity fold. */
	isLastToolGroup?: boolean
}

/**
 * Specialized component for rendering different message types
 * Handles activity folds, browser sessions, regular messages, and checkpoint logic
 */
const MessageRenderer: React.FC<MessageRendererProps> = ({
	index,
	messageOrGroup,
	groupedMessages,
	modifiedMessages,
	expandedRows,
	onToggleExpand,
	onHeightChange,
	onLastRowContentChange,
	onSetQuote,
	inputValue,
	messageHandlers,
	footerActive,
	isLastItem,
	isLastToolGroup: isLastToolGroupProp,
}) => {
	const { mode, turnState } = useExtensionState()

	const isLastMessage = useMemo(() => isLastItem ?? index === groupedMessages?.length - 1, [groupedMessages, index, isLastItem])

	// Get reasoning content and response status for api_req_started messages
	const reasoningData = useMemo(() => {
		if (!Array.isArray(messageOrGroup) && messageOrGroup.say === "api_req_started") {
			// Use the same message source-of-truth that `groupedMessages` is derived from.
			return findReasoningForApiReq(messageOrGroup.ts, modifiedMessages)
		}
		return { reasoning: undefined, responseStarted: false }
	}, [messageOrGroup, modifiedMessages])

	// Tool group (low-stakes tools grouped together)
	// Determine if this is the last tool group to show active items
	const isLastToolGroup = useMemo(() => {
		if (isLastToolGroupProp !== undefined) {
			return isLastToolGroupProp
		}
		if (!isToolGroup(messageOrGroup)) {
			return false
		}
		// Find the last tool group in groupedMessages
		for (let i = groupedMessages.length - 1; i >= 0; i--) {
			if (isToolGroup(groupedMessages[i])) {
				return i === index
			}
		}
		return false
	}, [messageOrGroup, groupedMessages, index, isLastToolGroupProp])

	// Activity fold (consecutive tool/command/thinking rows). Tail detection skips the synthetic
	// "Thinking..." row that MessagesArea appends, so the running fold stays open.
	const isLastActivityGroup = useMemo(() => {
		if (!isActivityGroup(messageOrGroup)) {
			return false
		}
		for (let i = groupedMessages.length - 1; i >= 0; i--) {
			if (isActivityGroup(groupedMessages[i])) {
				return i === index
			}
		}
		return false
	}, [messageOrGroup, groupedMessages, index])

	// Rows nested inside an activity fold reuse the regular rendering, recursively.
	const renderNestedItem = useCallback(
		(item: ChatListItem, nestedIndex: number, isLastNestedItem: boolean) => {
			const key = getGroupHeadMessage(item)?.ts ?? nestedIndex
			return (
				<MessageRenderer
					expandedRows={expandedRows}
					footerActive={footerActive}
					groupedMessages={groupedMessages}
					index={index}
					inputValue={inputValue}
					isLastItem={isLastNestedItem}
					isLastToolGroup={isLastActivityGroup}
					key={key}
					messageHandlers={messageHandlers}
					messageOrGroup={item as ClineMessage | ClineMessage[]}
					modifiedMessages={modifiedMessages}
					onHeightChange={onHeightChange}
					onLastRowContentChange={onLastRowContentChange}
					onSetQuote={onSetQuote}
					onToggleExpand={onToggleExpand}
				/>
			)
		},
		[
			expandedRows,
			footerActive,
			groupedMessages,
			index,
			inputValue,
			isLastActivityGroup,
			messageHandlers,
			modifiedMessages,
			onHeightChange,
			onLastRowContentChange,
			onSetQuote,
			onToggleExpand,
		],
	)

	if (isActivityGroup(messageOrGroup)) {
		return (
			<ActivityGroupRenderer
				expandedRows={expandedRows}
				group={messageOrGroup as ActivityGroup}
				isLastGroup={isLastActivityGroup}
				onToggleExpand={onToggleExpand}
				renderItem={renderNestedItem}
				turnPhase={turnState?.phase}
			/>
		)
	}

	if (isToolGroup(messageOrGroup)) {
		return <ToolGroupRenderer allMessages={modifiedMessages} isLastGroup={isLastToolGroup} messages={messageOrGroup} />
	}

	// Browser session group
	if (Array.isArray(messageOrGroup)) {
		return (
			<BrowserSessionRow
				expandedRows={expandedRows}
				isLast={isLastMessage}
				key={messageOrGroup[0]?.ts}
				lastModifiedMessage={modifiedMessages.at(-1)}
				messages={messageOrGroup}
				onHeightChange={onHeightChange}
				onSetQuote={onSetQuote}
				onToggleExpand={onToggleExpand}
			/>
		)
	}

	// Regular message
	return (
		<div
			className={cn({
				"pb-2.5": isLastMessage && !footerActive,
			})}
			data-message-ts={messageOrGroup.ts}>
			<ChatRow
				inputValue={inputValue}
				isExpanded={expandedRows[messageOrGroup.ts] || false}
				isLast={isLastMessage}
				key={messageOrGroup.ts}
				lastModifiedMessage={modifiedMessages.at(-1)}
				message={messageOrGroup}
				mode={mode}
				onCancelCommand={() => messageHandlers.executeButtonAction({ type: "cancel" })}
				onHeightChange={onHeightChange}
				onLastRowContentChange={onLastRowContentChange}
				onSetQuote={onSetQuote}
				onToggleExpand={onToggleExpand}
				reasoningContent={reasoningData.reasoning}
				responseStarted={reasoningData.responseStarted}
				retryFailedRequest={messageHandlers.retryFailedRequest}
				sendMessageFromChatRow={messageHandlers.handleSendMessage}
			/>
		</div>
	)
}

/**
 * Factory function to create the itemContent callback for Virtuoso
 * This allows us to encapsulate the rendering logic while maintaining performance
 */
export const createMessageRenderer = (
	groupedMessages: (ClineMessage | ClineMessage[])[],
	modifiedMessages: ClineMessage[],
	expandedRows: Record<number, boolean>,
	onToggleExpand: (ts: number, options?: { preserveAutoScroll?: boolean; next?: boolean }) => void,
	onHeightChange: (isTaller: boolean) => void,
	onLastRowContentChange: () => void,
	onSetQuote: (quote: string | null) => void,
	inputValue: string,
	messageHandlers: MessageHandlers,
	footerActive: boolean,
) => {
	return (index: number, messageOrGroup: ClineMessage | ClineMessage[]) => (
		<MessageRenderer
			expandedRows={expandedRows}
			footerActive={footerActive}
			groupedMessages={groupedMessages}
			index={index}
			inputValue={inputValue}
			messageHandlers={messageHandlers}
			messageOrGroup={messageOrGroup}
			modifiedMessages={modifiedMessages}
			onHeightChange={onHeightChange}
			onLastRowContentChange={onLastRowContentChange}
			onSetQuote={onSetQuote}
			onToggleExpand={onToggleExpand}
		/>
	)
}

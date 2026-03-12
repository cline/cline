import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import type React from "react"
import { memo, useMemo } from "react"
import BrowserSessionRow from "@/components/chat/BrowserSessionRow"
import ChatRow from "@/components/chat/ChatRow"
import { cn } from "@/lib/utils"
import type { MessageHandlers } from "../../types/chatTypes"
import { isToolGroup } from "../../utils/messageUtils"
import { ToolGroupRenderer } from "./ToolGroupRenderer"

interface MessageRendererProps {
	index: number
	messageOrGroup: ClineMessage | ClineMessage[]
	groupedMessages: (ClineMessage | ClineMessage[])[]
	modifiedMessages: ClineMessage[]
	rawMessages: ClineMessage[]
	mode: Mode
	expandedRows: Record<number, boolean>
	onToggleExpand: (ts: number) => void
	onHeightChange: (isTaller: boolean) => void
	onSetQuote: (quote: string | null) => void
	inputValue: string
	messageHandlers: MessageHandlers
	footerActive: boolean
	apiReqReasoningIndex: Map<number, { reasoning: string | undefined; responseStarted: boolean }>
	pendingTextMessageIndex: Set<number>
}

/**
 * Specialized component for rendering different message types
 * Handles browser sessions, regular messages, and checkpoint logic
 */
export const MessageRenderer: React.FC<MessageRendererProps> = ({
	index,
	messageOrGroup,
	groupedMessages,
	modifiedMessages,
	rawMessages,
	mode,
	expandedRows,
	onToggleExpand,
	onHeightChange,
	onSetQuote,
	inputValue,
	messageHandlers,
	footerActive,
	apiReqReasoningIndex,
	pendingTextMessageIndex,
}) => {
	const isLastMessage = useMemo(() => index === groupedMessages?.length - 1, [groupedMessages, index])

	const reasoningData = useMemo(() => {
		if (!Array.isArray(messageOrGroup) && messageOrGroup.say === "api_req_started") {
			return apiReqReasoningIndex.get(messageOrGroup.ts) ?? { reasoning: undefined, responseStarted: false }
		}
		return { reasoning: undefined, responseStarted: false }
	}, [apiReqReasoningIndex, messageOrGroup])

	const isRequestInProgress = useMemo(() => {
		if (!Array.isArray(messageOrGroup) && messageOrGroup.say === "text") {
			return pendingTextMessageIndex.has(messageOrGroup.ts)
		}
		return false
	}, [messageOrGroup, pendingTextMessageIndex])

	// Tool group (low-stakes tools grouped together)
	// Determine if this is the last tool group to show active items
	const isLastToolGroup = useMemo(() => {
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
	}, [messageOrGroup, groupedMessages, index])

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
				isRequestInProgress={isRequestInProgress}
				key={messageOrGroup.ts}
				lastModifiedMessage={modifiedMessages.at(-1)}
				message={messageOrGroup}
				mode={mode}
				onCancelCommand={() => messageHandlers.executeButtonAction("cancel")}
				onHeightChange={onHeightChange}
				onSetQuote={onSetQuote}
				onToggleExpand={onToggleExpand}
				reasoningContent={reasoningData.reasoning}
				responseStarted={reasoningData.responseStarted}
				sendMessageFromChatRow={messageHandlers.handleSendMessage}
			/>
		</div>
	)
}

export const MemoizedMessageRenderer = memo(MessageRenderer)

/**
 * Factory function to create the itemContent callback for Virtuoso
 * This allows us to encapsulate the rendering logic while maintaining performance
 */
export const createMessageRenderer = (
	groupedMessages: (ClineMessage | ClineMessage[])[],
	modifiedMessages: ClineMessage[],
	rawMessages: ClineMessage[],
	apiReqReasoningIndex: Map<number, { reasoning: string | undefined; responseStarted: boolean }>,
	pendingTextMessageIndex: Set<number>,
	mode: Mode,
	expandedRows: Record<number, boolean>,
	onToggleExpand: (ts: number) => void,
	onHeightChange: (isTaller: boolean) => void,
	onSetQuote: (quote: string | null) => void,
	inputValue: string,
	messageHandlers: MessageHandlers,
	footerActive: boolean,
) => {
	return (index: number, messageOrGroup: ClineMessage | ClineMessage[]) => (
		<MemoizedMessageRenderer
			apiReqReasoningIndex={apiReqReasoningIndex}
			expandedRows={expandedRows}
			footerActive={footerActive}
			groupedMessages={groupedMessages}
			index={index}
			inputValue={inputValue}
			messageHandlers={messageHandlers}
			messageOrGroup={messageOrGroup}
			mode={mode}
			modifiedMessages={modifiedMessages}
			onHeightChange={onHeightChange}
			onSetQuote={onSetQuote}
			onToggleExpand={onToggleExpand}
			pendingTextMessageIndex={pendingTextMessageIndex}
			rawMessages={rawMessages}
		/>
	)
}

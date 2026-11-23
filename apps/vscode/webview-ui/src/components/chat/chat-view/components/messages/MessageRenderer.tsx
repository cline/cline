import type { ClineApiReqInfo, ClineMessage } from "@shared/ExtensionMessage"
import type React from "react"
import { useMemo } from "react"
import BrowserSessionRow from "@/components/chat/BrowserSessionRow"
import ChatRow from "@/components/chat/ChatRow"
import { MessageMetricsBar } from "@/components/chat/MessageMetricsBar"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useNormalizedApiConfiguration } from "@/hooks/useNormalizedApiConfiguration"
import { cn } from "@/lib/utils"
import type { MessageHandlers } from "../../types/chatTypes"
import { findReasoningForApiReq, isToolGroup } from "../../utils/messageUtils"
import { ToolGroupRenderer } from "./ToolGroupRenderer"

function parseApiReqUsage(msg: ClineMessage): ClineApiReqInfo | undefined {
	if (msg.type !== "say" || msg.say !== "api_req_started" || !msg.text) {
		return undefined
	}
	try {
		const info = JSON.parse(msg.text) as ClineApiReqInfo
		if (
			info.tokensIn !== undefined ||
			info.tokensOut !== undefined ||
			info.tokensPerSecond !== undefined ||
			info.durationMs !== undefined
		) {
			return info
		}
	} catch {
		// ignore malformed json
	}
	return undefined
}

function findMetricsForAssistantMessage(message: ClineMessage, modifiedMessages: ClineMessage[]): ClineApiReqInfo | undefined {
	if (
		message.partial === true ||
		message.type !== "say" ||
		(message.say !== "text" && message.say !== "completion_result" && message.say !== "plan_completion_result")
	) {
		return undefined
	}
	const idx = modifiedMessages.findIndex((m) => m.ts === message.ts)
	if (idx === -1) {
		return undefined
	}

	// SDK emits the usage api_req_started right after the iteration's messages
	for (let i = idx + 1; i < modifiedMessages.length; i++) {
		const candidate = modifiedMessages[i]
		if (candidate.say === "user_feedback" || candidate.say === "task") {
			break
		}
		if (
			candidate.type === "say" &&
			(candidate.say === "text" || candidate.say === "completion_result" || candidate.say === "plan_completion_result")
		) {
			break
		}
		const usage = parseApiReqUsage(candidate)
		if (usage) {
			return usage
		}
	}

	// Fallback for classic combined api_req_started placed before the assistant message
	for (let i = idx - 1; i >= 0; i--) {
		const candidate = modifiedMessages[i]
		if (candidate.say === "user_feedback" || candidate.say === "task") {
			break
		}
		const usage = parseApiReqUsage(candidate)
		if (usage) {
			return usage
		}
	}
	return undefined
}

interface MessageRendererProps {
	index: number
	messageOrGroup: ClineMessage | ClineMessage[]
	groupedMessages: (ClineMessage | ClineMessage[])[]
	modifiedMessages: ClineMessage[]
	expandedRows: Record<number, boolean>
	onToggleExpand: (ts: number, options?: { preserveAutoScroll?: boolean }) => void
	onHeightChange: (isTaller: boolean) => void
	onLastRowContentChange: () => void
	onSetQuote: (quote: string | null) => void
	inputValue: string
	messageHandlers: MessageHandlers
	footerActive: boolean
}

/**
 * Specialized component for rendering different message types
 * Handles browser sessions, regular messages, and checkpoint logic
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
}) => {
	const { mode } = useExtensionState()
	const { selectedModelInfo } = useNormalizedApiConfiguration(mode)

	const messageMetrics = useMemo(() => {
		if (Array.isArray(messageOrGroup)) {
			return undefined
		}
		return findMetricsForAssistantMessage(messageOrGroup, modifiedMessages)
	}, [messageOrGroup, modifiedMessages])

	const isLastMessage = useMemo(() => index === groupedMessages?.length - 1, [groupedMessages, index])

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
		return (
			<div className="w-full max-w-[820px] mx-auto px-4 sm:px-6">
				<ToolGroupRenderer allMessages={modifiedMessages} isLastGroup={isLastToolGroup} messages={messageOrGroup} />
			</div>
		)
	}

	// Browser session group
	if (Array.isArray(messageOrGroup)) {
		return (
			<div className="w-full max-w-[820px] mx-auto px-4 sm:px-6">
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
			</div>
		)
	}

	// Regular message
	return (
		<div
			className={cn("w-full max-w-[820px] mx-auto px-4 sm:px-6", {
				"pb-4": isLastMessage && !footerActive,
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
			{messageMetrics && (
				<MessageMetricsBar contextWindow={selectedModelInfo?.contextWindow} metrics={messageMetrics} />
			)}
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
	onToggleExpand: (ts: number, options?: { preserveAutoScroll?: boolean }) => void,
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

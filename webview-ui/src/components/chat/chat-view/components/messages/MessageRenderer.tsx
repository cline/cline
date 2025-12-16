import { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import React, { memo, useCallback, useMemo, useState } from "react"
import BrowserSessionRow from "@/components/chat/BrowserSessionRow"
import ChatRow from "@/components/chat/ChatRow"
import { cleanPathPrefix } from "@/components/common/CodeAccordian"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"
import { MessageHandlers } from "../../types/chatTypes"
import {
	findReasoningForApiReq,
	isApiReqAbsorbable,
	isLowStakesTool,
	isTextMessagePendingToolCall,
	isToolGroup,
} from "../../utils/messageUtils"

/**
 * Get display info for a tool message
 */
function getToolDisplayInfo(message: ClineMessage): { icon: string; path: string; label: string } | null {
	if (message.say !== "tool" && message.ask !== "tool") return null
	try {
		const tool = JSON.parse(message.text || "{}") as ClineSayTool
		switch (tool.tool) {
			case "readFile":
				return { icon: "file-code", path: tool.path || "", label: "read" }
			case "listFilesTopLevel":
				return { icon: "folder-opened", path: tool.path || "", label: "listed" }
			case "listFilesRecursive":
				return { icon: "folder-opened", path: tool.path || "", label: "listed recursively" }
			case "listCodeDefinitionNames":
				return { icon: "symbol-class", path: tool.path || "", label: "definitions" }
			case "searchFiles":
				return { icon: "search", path: tool.path || "", label: `search: ${tool.regex}` }
			default:
				return null
		}
	} catch {
		return null
	}
}

/**
 * Get summary label for a tool group
 */
function getToolGroupSummary(messages: ClineMessage[]): string {
	const toolTypes: string[] = []
	for (const m of messages) {
		if (!isLowStakesTool(m)) continue
		try {
			const tool = JSON.parse(m.text || "{}") as ClineSayTool
			if (tool?.tool) toolTypes.push(tool.tool)
		} catch {
			// ignore parse errors
		}
	}

	const readCount = toolTypes.filter((t) => t === "readFile").length
	const listCount = toolTypes.filter((t) => t === "listFilesTopLevel" || t === "listFilesRecursive").length
	const searchCount = toolTypes.filter((t) => t === "searchFiles").length
	const defCount = toolTypes.filter((t) => t === "listCodeDefinitionNames").length

	const parts: string[] = []
	if (readCount > 0) parts.push(`${readCount} file${readCount > 1 ? "s" : ""}`)
	if (listCount > 0) parts.push(`${listCount} folder${listCount > 1 ? "s" : ""}`)
	if (searchCount > 0) parts.push(`${searchCount} search${searchCount > 1 ? "es" : ""}`)
	if (defCount > 0) parts.push(`${defCount} definition${defCount > 1 ? "s" : ""}`)

	if (parts.length === 0) return "Files"
	return parts.join(", ")
}

interface ToolGroupRendererProps {
	messages: ClineMessage[]
	expandedRows: Record<number, boolean>
	onToggleExpand: (ts: number) => void
	index: number
	groupedMessages: (ClineMessage | ClineMessage[])[]
	allMessages: ClineMessage[]
}

/**
 * Check if a tool has expandable content (folders, search results, definitions)
 */
function hasExpandableContent(tool: ClineSayTool): boolean {
	return ["listFilesTopLevel", "listFilesRecursive", "listCodeDefinitionNames", "searchFiles"].includes(tool.tool)
}

/**
 * Renders a collapsible group of low-stakes tool calls
 */
const ToolGroupRenderer = memo(
	({ messages, expandedRows, onToggleExpand, index, groupedMessages, allMessages }: ToolGroupRendererProps) => {
		const groupTs = messages[0]?.ts || 0
		const isExpanded = expandedRows[groupTs] ?? true // Default expanded
		const isLast = index === groupedMessages.length - 1

		// Track which individual tool items are expanded (for folders, search, etc.)
		const [expandedItems, setExpandedItems] = useState<Record<number, boolean>>({})

		const handleToggle = useCallback(() => {
			onToggleExpand(groupTs)
		}, [onToggleExpand, groupTs])

		const handleOpenFile = useCallback((filePath: string) => {
			FileServiceClient.openFileRelativePath(StringRequest.create({ value: filePath })).catch((err) =>
				console.error("Failed to open file:", err),
			)
		}, [])

		const handleItemToggle = useCallback((ts: number) => {
			setExpandedItems((prev) => ({ ...prev, [ts]: !prev[ts] }))
		}, [])

		const summary = useMemo(() => getToolGroupSummary(messages), [messages])

		// Build tool items with associated reasoning (reasoning that comes BEFORE a tool)
		const toolsWithReasoning = useMemo(() => {
			const result: { tool: ClineMessage; parsedTool: ClineSayTool; reasoning?: string }[] = []
			let pendingReasoning: string[] = []

			for (const msg of messages) {
				if (msg.say === "reasoning" && msg.text) {
					pendingReasoning.push(msg.text)
				} else if (isLowStakesTool(msg)) {
					let parsedTool: ClineSayTool
					try {
						parsedTool = JSON.parse(msg.text || "{}") as ClineSayTool
					} catch {
						parsedTool = { tool: "" } as unknown as ClineSayTool
					}

					result.push({
						tool: msg,
						parsedTool,
						reasoning: pendingReasoning.length > 0 ? pendingReasoning.join("\n\n") : undefined,
					})
					pendingReasoning = []
				}
			}
			return result
		}, [messages])

		return (
			<div className={cn("px-4 py-2", { "pb-4": isLast })} style={{ color: "var(--vscode-descriptionForeground)" }}>
				{/* Collapsible header */}
				<div
					onClick={handleToggle}
					style={{
						display: "flex",
						alignItems: "center",
						gap: "6px",
						cursor: "pointer",
						userSelect: "none",
						fontSize: "13px",
					}}>
					<span
						className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`}
						style={{ fontSize: "12px", opacity: 0.7 }}
					/>
					<span style={{ opacity: 0.9, flex: 1 }}>{summary}</span>
				</div>

				{/* Expanded content - files/folders with reasoning in tooltip */}
				{isExpanded && (
					<div style={{ marginLeft: "18px", marginTop: "2px" }}>
						{toolsWithReasoning.map(({ tool, parsedTool, reasoning }) => {
							const info = getToolDisplayInfo(tool)
							if (!info) return null
							const isExpandable = hasExpandableContent(parsedTool)
							const isItemExpanded = expandedItems[tool.ts] ?? false
							const content = parsedTool.content || null

							return (
								<div key={tool.ts}>
									<div
										onClick={() => {
											if (isExpandable) {
												handleItemToggle(tool.ts)
											} else {
												handleOpenFile(info.path)
											}
										}}
										{...(reasoning ? { title: reasoning } : {})}
										onMouseEnter={(e) => {
											e.currentTarget.style.color = "var(--vscode-textLink-foreground)"
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.color = "var(--vscode-descriptionForeground)"
										}}
										style={{
											display: "flex",
											alignItems: "center",
											gap: "6px",
											padding: "2px 0",
											fontSize: "12px",
											cursor: "pointer",
											fontFamily: "var(--vscode-editor-font-family)",
										}}>
										<span
											className={`codicon codicon-${info.icon}`}
											style={{ fontSize: "12px", opacity: 0.7 }}
										/>
										<span
											style={{
												flex: 1,
												whiteSpace: "nowrap",
												overflow: "hidden",
												textOverflow: "ellipsis",
												direction: "rtl",
												textAlign: "left",
											}}>
											{cleanPathPrefix(info.path) + "\u200E"}
										</span>
									</div>
									{/* Expanded content for folders/search/definitions - raw text */}
									{isExpandable && isItemExpanded && content && (
										<pre
											style={{
												marginLeft: "24px",
												marginTop: "4px",
												marginBottom: "4px",
												fontSize: "11px",
												opacity: 0.8,
												whiteSpace: "pre-wrap",
												wordBreak: "break-word",
											}}>
											{content}
										</pre>
									)}
								</div>
							)
						})}
					</div>
				)}
			</div>
		)
	},
)

interface MessageRendererProps {
	index: number
	messageOrGroup: ClineMessage | ClineMessage[]
	groupedMessages: (ClineMessage | ClineMessage[])[]
	modifiedMessages: ClineMessage[]
	expandedRows: Record<number, boolean>
	onToggleExpand: (ts: number) => void
	onHeightChange: (isTaller: boolean) => void
	onSetQuote: (quote: string | null) => void
	inputValue: string
	messageHandlers: MessageHandlers
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
	expandedRows,
	onToggleExpand,
	onHeightChange,
	onSetQuote,
	inputValue,
	messageHandlers,
}) => {
	const { mode } = useExtensionState()

	// Get reasoning content and response status for api_req_started messages
	const reasoningData = useMemo(() => {
		if (!Array.isArray(messageOrGroup) && messageOrGroup.say === "api_req_started") {
			// Use the same message source-of-truth that `groupedMessages` is derived from.
			return findReasoningForApiReq(messageOrGroup.ts, modifiedMessages)
		}
		return { reasoning: undefined, responseStarted: false }
	}, [messageOrGroup, modifiedMessages])

	// Check if a text message is waiting for tool call completion
	const isRequestInProgress = useMemo(() => {
		if (!Array.isArray(messageOrGroup) && messageOrGroup.say === "text") {
			// Use modifiedMessages so this stays consistent with the rendered list.
			return isTextMessagePendingToolCall(messageOrGroup.ts, modifiedMessages)
		}
		return false
	}, [messageOrGroup, modifiedMessages])

	// Tool group (low-stakes tools grouped together)
	if (isToolGroup(messageOrGroup)) {
		return (
			<ToolGroupRenderer
				allMessages={modifiedMessages}
				expandedRows={expandedRows}
				groupedMessages={groupedMessages}
				index={index}
				messages={messageOrGroup}
				onToggleExpand={onToggleExpand}
			/>
		)
	}

	// Browser session group
	if (Array.isArray(messageOrGroup)) {
		return (
			<BrowserSessionRow
				expandedRows={expandedRows}
				isLast={index === groupedMessages.length - 1}
				key={messageOrGroup[0]?.ts}
				lastModifiedMessage={modifiedMessages.at(-1)}
				messages={messageOrGroup}
				onHeightChange={onHeightChange}
				onSetQuote={onSetQuote}
				onToggleExpand={onToggleExpand}
			/>
		)
	}

	// Deterministic flash fix:
	// If this api_req_started is meant to be absorbed into a low-stakes tool group,
	// never render it as a standalone row.
	if (messageOrGroup.say === "api_req_started" && isApiReqAbsorbable(messageOrGroup.ts, modifiedMessages)) {
		return null
	}

	// Determine if this is the last message for status display purposes
	const nextMessage = index < groupedMessages.length - 1 && groupedMessages[index + 1]
	const isNextCheckpoint = !Array.isArray(nextMessage) && nextMessage && nextMessage?.say === "checkpoint_created"
	const isLastMessageGroup = isNextCheckpoint && index === groupedMessages.length - 2
	const isLast = index === groupedMessages.length - 1 || isLastMessageGroup

	// Regular message
	return (
		<div
			className={cn({
				"pb-2.5": isLast,
			})}
			data-message-ts={messageOrGroup.ts}>
			<ChatRow
				inputValue={inputValue}
				isExpanded={expandedRows[messageOrGroup.ts] || false}
				isLast={isLast}
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

/**
 * Factory function to create the itemContent callback for Virtuoso
 * This allows us to encapsulate the rendering logic while maintaining performance
 */
export const createMessageRenderer = (
	groupedMessages: (ClineMessage | ClineMessage[])[],
	modifiedMessages: ClineMessage[],
	expandedRows: Record<number, boolean>,
	onToggleExpand: (ts: number) => void,
	onHeightChange: (isTaller: boolean) => void,
	onSetQuote: (quote: string | null) => void,
	inputValue: string,
	messageHandlers: MessageHandlers,
) => {
	return (index: number, messageOrGroup: ClineMessage | ClineMessage[]) => (
		<MessageRenderer
			expandedRows={expandedRows}
			groupedMessages={groupedMessages}
			index={index}
			inputValue={inputValue}
			messageHandlers={messageHandlers}
			messageOrGroup={messageOrGroup}
			modifiedMessages={modifiedMessages}
			onHeightChange={onHeightChange}
			onSetQuote={onSetQuote}
			onToggleExpand={onToggleExpand}
		/>
	)
}

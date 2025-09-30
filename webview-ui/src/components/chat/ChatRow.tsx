import { COMMAND_OUTPUT_STRING, COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import {
	ClineApiReqInfo,
	ClineAskQuestion,
	ClineAskUseMcpServer,
	ClineMessage,
	ClinePlanModeResponse,
	ClineSayTool,
	COMPLETION_RESULT_CHANGES_FLAG,
} from "@shared/ExtensionMessage"
import { Int64Request, StringRequest } from "@shared/proto/cline/common"
import { VSCodeBadge, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import deepEqual from "fast-deep-equal"
import React, { MouseEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSize } from "react-use"
import styled from "styled-components"
import { OptionsButtons } from "@/components/chat/OptionsButtons"
import TaskFeedbackButtons from "@/components/chat/TaskFeedbackButtons"
import { CheckmarkControl } from "@/components/common/CheckmarkControl"
import CodeBlock, { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import { WithCopyButton } from "@/components/common/CopyButton"
import MarkdownBlock from "@/components/common/MarkdownBlock"
import SuccessButton from "@/components/common/SuccessButton"
import McpResponseDisplay from "@/components/mcp/chat-display/McpResponseDisplay"
import McpResourceRow from "@/components/mcp/configuration/tabs/installed/server-row/McpResourceRow"
import McpToolRow from "@/components/mcp/configuration/tabs/installed/server-row/McpToolRow"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient, TaskServiceClient, UiServiceClient } from "@/services/grpc-client"
import { findMatchingResourceOrTemplate, getMcpServerDisplayName } from "@/utils/mcp"
import { CheckpointControls } from "../common/CheckpointControls"
import CodeAccordian, { cleanPathPrefix } from "../common/CodeAccordian"
import { ErrorBlockTitle } from "./ErrorBlockTitle"
import ErrorRow from "./ErrorRow"
import NewTaskPreview from "./NewTaskPreview"
import QuoteButton from "./QuoteButton"
import ReportBugPreview from "./ReportBugPreview"
import SearchResultsDisplay from "./SearchResultsDisplay"
import UserMessage from "./UserMessage"

const normalColor = "var(--vscode-foreground)"
const errorColor = "var(--vscode-errorForeground)"
const successColor = "var(--vscode-charts-green)"
const _cancelledColor = "var(--vscode-descriptionForeground)"

const ChatRowContainer = styled.div`
	padding: 10px 6px 10px 15px;
	position: relative;

	&:hover ${CheckpointControls} {
		opacity: 1;
	}
`

interface ChatRowProps {
	message: ClineMessage
	isExpanded: boolean
	onToggleExpand: (ts: number) => void
	lastModifiedMessage?: ClineMessage
	isLast: boolean
	onHeightChange: (isTaller: boolean) => void
	inputValue?: string
	sendMessageFromChatRow?: (text: string, images: string[], files: string[]) => void
	onSetQuote: (text: string) => void
}

interface QuoteButtonState {
	visible: boolean
	top: number
	left: number
	selectedText: string
}

interface ChatRowContentProps extends Omit<ChatRowProps, "onHeightChange"> {}

export const ProgressIndicator = () => (
	<div
		style={{
			width: "16px",
			height: "16px",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
		}}>
		<div style={{ transform: "scale(0.55)", transformOrigin: "center" }}>
			<VSCodeProgressRing />
		</div>
	</div>
)

const Markdown = memo(({ markdown }: { markdown?: string }) => {
	return (
		<div
			style={{
				wordBreak: "break-word",
				overflowWrap: "anywhere",
				marginBottom: -15,
				marginTop: -15,
				overflow: "hidden", // contain child margins so that parent diff matches height of children
			}}>
			<MarkdownBlock markdown={markdown} />
		</div>
	)
})

const ChatRow = memo(
	(props: ChatRowProps) => {
		const { isLast, onHeightChange, message } = props
		// Store the previous height to compare with the current height
		// This allows us to detect changes without causing re-renders
		const prevHeightRef = useRef(0)

		const [chatrow, { height }] = useSize(
			<ChatRowContainer>
				<ChatRowContent {...props} />
			</ChatRowContainer>,
		)

		useEffect(() => {
			// used for partials command output etc.
			// NOTE: it's important we don't distinguish between partial or complete here since our scroll effects in chatview need to handle height change during partial -> complete
			const isInitialRender = prevHeightRef.current === 0 // prevents scrolling when new element is added since we already scroll for that
			// height starts off at Infinity
			if (isLast && height !== 0 && height !== Infinity && height !== prevHeightRef.current) {
				if (!isInitialRender) {
					onHeightChange(height > prevHeightRef.current)
				}
				prevHeightRef.current = height
			}
		}, [height, isLast, onHeightChange, message])

		// we cannot return null as virtuoso does not support it so we use a separate visibleMessages array to filter out messages that should not be rendered
		return chatrow
	},
	// memo does shallow comparison of props, so we need to do deep comparison of arrays/objects whose properties might change
	deepEqual,
)

export default ChatRow

export const ChatRowContent = memo(
	({
		message,
		isExpanded,
		onToggleExpand,
		lastModifiedMessage,
		isLast,
		inputValue,
		sendMessageFromChatRow,
		onSetQuote,
	}: ChatRowContentProps) => {
		const { mcpServers, mcpMarketplaceCatalog, onRelinquishControl } = useExtensionState()
		const [seeNewChangesDisabled, setSeeNewChangesDisabled] = useState(false)
		const [quoteButtonState, setQuoteButtonState] = useState<QuoteButtonState>({
			visible: false,
			top: 0,
			left: 0,
			selectedText: "",
		})
		const contentRef = useRef<HTMLDivElement>(null)
		const [cost, apiReqCancelReason, apiReqStreamingFailedMessage, retryStatus] = useMemo(() => {
			if (message.text != null && message.say === "api_req_started") {
				const info: ClineApiReqInfo = JSON.parse(message.text)
				return [info.cost, info.cancelReason, info.streamingFailedMessage, info.retryStatus]
			}
			return [undefined, undefined, undefined, undefined, undefined]
		}, [message.text, message.say])

		// when resuming task last won't be api_req_failed but a resume_task message so api_req_started will show loading spinner. that's why we just remove the last api_req_started that failed without streaming anything
		const apiRequestFailedMessage =
			isLast && lastModifiedMessage?.ask === "api_req_failed" // if request is retried then the latest message is a api_req_retried
				? lastModifiedMessage?.text
				: undefined

		const isCommandExecuting =
			isLast &&
			(lastModifiedMessage?.ask === "command" || lastModifiedMessage?.say === "command") &&
			lastModifiedMessage?.text?.includes(COMMAND_OUTPUT_STRING)

		const isMcpServerResponding = isLast && lastModifiedMessage?.say === "mcp_server_request_started"

		const type = message.type === "ask" ? message.ask : message.say

		const handleToggle = useCallback(() => {
			onToggleExpand(message.ts)
		}, [onToggleExpand, message.ts])

		// Use the onRelinquishControl hook instead of message event
		useEffect(() => {
			return onRelinquishControl(() => {
				setSeeNewChangesDisabled(false)
			})
		}, [onRelinquishControl])

		// --- Quote Button Logic ---
		// MOVE handleQuoteClick INSIDE ChatRowContent
		const handleQuoteClick = useCallback(() => {
			onSetQuote(quoteButtonState.selectedText)
			window.getSelection()?.removeAllRanges() // Clear the browser selection
			setQuoteButtonState({ visible: false, top: 0, left: 0, selectedText: "" })
		}, [onSetQuote, quoteButtonState.selectedText]) // <-- Use onSetQuote from props

		const handleMouseUp = useCallback((event: MouseEvent<HTMLDivElement>) => {
			// Get the target element immediately, before the timeout
			const targetElement = event.target as Element
			const isClickOnButton = !!targetElement.closest(".quote-button-class")

			// Delay the selection check slightly
			setTimeout(() => {
				// Now, check the selection state *after* the browser has likely updated it
				const selection = window.getSelection()
				const selectedText = selection?.toString().trim() ?? ""

				let shouldShowButton = false
				let buttonTop = 0
				let buttonLeft = 0
				let textToQuote = ""

				// Condition 1: Check if there's a valid, non-collapsed selection within bounds
				// Ensure contentRef.current still exists in case component unmounted during timeout
				if (selectedText && contentRef.current && selection && selection.rangeCount > 0 && !selection.isCollapsed) {
					const range = selection.getRangeAt(0)
					const rangeRect = range.getBoundingClientRect()
					// Re-check ref inside timeout and ensure containerRect is valid
					const containerRect = contentRef.current?.getBoundingClientRect()

					if (containerRect) {
						// Check if containerRect was successfully obtained
						const tolerance = 5 // Allow for a small pixel overflow (e.g., for margins)
						const isSelectionWithin =
							rangeRect.top >= containerRect.top &&
							rangeRect.left >= containerRect.left &&
							rangeRect.bottom <= containerRect.bottom + tolerance && // Added tolerance
							rangeRect.right <= containerRect.right

						if (isSelectionWithin) {
							shouldShowButton = true // Mark that we should show the button
							const buttonHeight = 30
							// Calculate the raw top position relative to the container, placing it above the selection
							const calculatedTop = rangeRect.top - containerRect.top - buttonHeight - 5 // Subtract button height and a small margin
							// Allow the button to potentially have a negative top value
							buttonTop = calculatedTop
							buttonLeft = Math.max(0, rangeRect.left - containerRect.left) // Still prevent going left of container
							textToQuote = selectedText
						}
					}
				}

				// Decision: Set the state based on whether we should show or hide
				if (shouldShowButton) {
					// Scenario A: Valid selection exists -> Show button
					setQuoteButtonState({
						visible: true,
						top: buttonTop,
						left: buttonLeft,
						selectedText: textToQuote,
					})
				} else if (!isClickOnButton) {
					// Scenario B: No valid selection AND click was NOT on button -> Hide button
					setQuoteButtonState({ visible: false, top: 0, left: 0, selectedText: "" })
				}
				// Scenario C (Click WAS on button): Do nothing here, handleQuoteClick takes over.
			}, 0) // Delay of 0ms pushes execution after current event cycle
		}, []) // Dependencies remain empty

		const [icon, title] = useMemo(() => {
			switch (type) {
				case "error":
					return [
						<span
							className="codicon codicon-error"
							style={{
								color: errorColor,
								marginBottom: "-1.5px",
							}}></span>,
						<span style={{ color: errorColor, fontWeight: "bold" }}>Error</span>,
					]
				case "mistake_limit_reached":
					return [
						<span
							className="codicon codicon-error"
							style={{
								color: errorColor,
								marginBottom: "-1.5px",
							}}></span>,
						<span style={{ color: errorColor, fontWeight: "bold" }}>Cline is having trouble...</span>,
					]
				case "auto_approval_max_req_reached":
					return [
						<span
							className="codicon codicon-warning"
							style={{
								color: errorColor,
								marginBottom: "-1.5px",
							}}></span>,
						<span style={{ color: errorColor, fontWeight: "bold" }}>Maximum Requests Reached</span>,
					]
				case "command":
					return [
						isCommandExecuting ? (
							<ProgressIndicator />
						) : (
							<span
								className="codicon codicon-terminal"
								style={{
									color: normalColor,
									marginBottom: "-1.5px",
								}}></span>
						),
						<span style={{ color: normalColor, fontWeight: "bold" }}>Cline wants to execute this command:</span>,
					]
				case "use_mcp_server":
					const mcpServerUse = JSON.parse(message.text || "{}") as ClineAskUseMcpServer
					return [
						isMcpServerResponding ? (
							<ProgressIndicator />
						) : (
							<span
								className="codicon codicon-server"
								style={{
									color: normalColor,
									marginBottom: "-1.5px",
								}}></span>
						),
						<span
							className="ph-no-capture"
							style={{ color: normalColor, fontWeight: "bold", wordBreak: "break-word" }}>
							Cline wants to {mcpServerUse.type === "use_mcp_tool" ? "use a tool" : "access a resource"} on the{" "}
							<code style={{ wordBreak: "break-all" }}>
								{getMcpServerDisplayName(mcpServerUse.serverName, mcpMarketplaceCatalog)}
							</code>{" "}
							MCP server:
						</span>,
					]
				case "completion_result":
					return [
						<span
							className="codicon codicon-check"
							style={{
								color: successColor,
								marginBottom: "-1.5px",
							}}></span>,
						<span style={{ color: successColor, fontWeight: "bold" }}>Task Completed</span>,
					]
				case "api_req_started":
					return ErrorBlockTitle({
						cost,
						apiReqCancelReason,
						apiRequestFailedMessage,
						retryStatus,
					})
				case "followup":
					return [
						<span
							className="codicon codicon-question"
							style={{
								color: normalColor,
								marginBottom: "-1.5px",
							}}></span>,
						<span style={{ color: normalColor, fontWeight: "bold" }}>Cline has a question:</span>,
					]
				default:
					return [null, null]
			}
		}, [type, cost, apiRequestFailedMessage, isCommandExecuting, apiReqCancelReason, isMcpServerResponding, message.text])

		const headerStyle: React.CSSProperties = {
			display: "flex",
			alignItems: "center",
			gap: "10px",
			marginBottom: "12px",
		}

		const _pStyle: React.CSSProperties = {
			margin: 0,
			whiteSpace: "pre-wrap",
			wordBreak: "break-word",
			overflowWrap: "anywhere",
		}

		const tool = useMemo(() => {
			if (message.ask === "tool" || message.say === "tool") {
				return JSON.parse(message.text || "{}") as ClineSayTool
			}
			return null
		}, [message.ask, message.say, message.text])

		// Helper function to check if file is an image
		const isImageFile = (filePath: string): boolean => {
			const imageExtensions = [".png", ".jpg", ".jpeg", ".webp"]
			const extension = filePath.toLowerCase().split(".").pop()
			return extension ? imageExtensions.includes(`.${extension}`) : false
		}

		if (tool) {
			const colorMap = {
				red: "var(--vscode-errorForeground)",
				yellow: "var(--vscode-editorWarning-foreground)",
				green: "var(--vscode-charts-green)",
			}
			const toolIcon = (name: string, color?: string, rotation?: number, title?: string) => (
				<span
					className={`codicon codicon-${name} ph-no-capture`}
					style={{
						color: color ? colorMap[color as keyof typeof colorMap] || color : "var(--vscode-foreground)",
						marginBottom: "-1.5px",
						transform: rotation ? `rotate(${rotation}deg)` : undefined,
					}}
					title={title}></span>
			)

			switch (tool.tool) {
				case "editedExistingFile":
					return (
						<>
							<div style={headerStyle}>
								{toolIcon("edit")}
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This file is outside of your workspace")}
								<span style={{ fontWeight: "bold" }}>Cline wants to edit this file:</span>
							</div>
							<CodeAccordian
								// isLoading={message.partial}
								code={tool.content}
								isExpanded={isExpanded}
								onToggleExpand={handleToggle}
								path={tool.path!}
							/>
						</>
					)
				case "newFileCreated":
					return (
						<>
							<div style={headerStyle}>
								{toolIcon("new-file")}
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This file is outside of your workspace")}
								<span style={{ fontWeight: "bold" }}>Cline wants to create a new file:</span>
							</div>
							<CodeAccordian
								code={tool.content!}
								isExpanded={isExpanded}
								isLoading={message.partial}
								onToggleExpand={handleToggle}
								path={tool.path!}
							/>
						</>
					)
				case "readFile":
					const isImage = isImageFile(tool.path || "")
					return (
						<>
							<div style={headerStyle}>
								{toolIcon(isImage ? "file-media" : "file-code")}
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This file is outside of your workspace")}
								<span style={{ fontWeight: "bold" }}>
									{/* {message.type === "ask" ? "" : "Cline read this file:"} */}
									Cline wants to read this file:
								</span>
							</div>
							<div
								style={{
									borderRadius: 3,
									backgroundColor: CODE_BLOCK_BG_COLOR,
									overflow: "hidden",
									border: "1px solid var(--vscode-editorGroup-border)",
								}}>
								<div
									onClick={
										isImage
											? undefined
											: () => {
													FileServiceClient.openFile(
														StringRequest.create({ value: tool.content }),
													).catch((err) => console.error("Failed to open file:", err))
												}
									}
									style={{
										color: "var(--vscode-descriptionForeground)",
										display: "flex",
										alignItems: "center",
										padding: "9px 10px",
										cursor: isImage ? "default" : "pointer",
										userSelect: isImage ? "text" : "none",
										WebkitUserSelect: isImage ? "text" : "none",
										MozUserSelect: isImage ? "text" : "none",
										msUserSelect: isImage ? "text" : "none",
									}}>
									{tool.path?.startsWith(".") && <span>.</span>}
									{tool.path && !tool.path.startsWith(".") && <span>/</span>}
									<span
										className="ph-no-capture"
										style={{
											whiteSpace: "nowrap",
											overflow: "hidden",
											textOverflow: "ellipsis",
											marginRight: "8px",
											direction: "rtl",
											textAlign: "left",
										}}>
										{cleanPathPrefix(tool.path ?? "") + "\u200E"}
									</span>
									<div style={{ flexGrow: 1 }}></div>
									{!isImage && (
										<span
											className={`codicon codicon-link-external`}
											style={{
												fontSize: 13.5,
												margin: "1px 0",
											}}></span>
									)}
								</div>
							</div>
						</>
					)
				case "listFilesTopLevel":
					return (
						<>
							<div style={headerStyle}>
								{toolIcon("folder-opened")}
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This is outside of your workspace")}
								<span style={{ fontWeight: "bold" }}>
									{message.type === "ask"
										? "Cline wants to view the top level files in this directory:"
										: "Cline viewed the top level files in this directory:"}
								</span>
							</div>
							<CodeAccordian
								code={tool.content!}
								isExpanded={isExpanded}
								language="shell-session"
								onToggleExpand={handleToggle}
								path={tool.path!}
							/>
						</>
					)
				case "listFilesRecursive":
					return (
						<>
							<div style={headerStyle}>
								{toolIcon("folder-opened")}
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This is outside of your workspace")}
								<span style={{ fontWeight: "bold" }}>
									{message.type === "ask"
										? "Cline wants to recursively view all files in this directory:"
										: "Cline recursively viewed all files in this directory:"}
								</span>
							</div>
							<CodeAccordian
								code={tool.content!}
								isExpanded={isExpanded}
								language="shell-session"
								onToggleExpand={handleToggle}
								path={tool.path!}
							/>
						</>
					)
				case "listCodeDefinitionNames":
					return (
						<>
							<div style={headerStyle}>
								{toolIcon("file-code")}
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This file is outside of your workspace")}
								<span style={{ fontWeight: "bold" }}>
									{message.type === "ask"
										? "Cline wants to view source code definition names used in this directory:"
										: "Cline viewed source code definition names used in this directory:"}
								</span>
							</div>
							<CodeAccordian
								code={tool.content!}
								isExpanded={isExpanded}
								onToggleExpand={handleToggle}
								path={tool.path!}
							/>
						</>
					)
				case "searchFiles":
					return (
						<>
							<div style={headerStyle}>
								{toolIcon("search")}
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This is outside of your workspace")}
								<span style={{ fontWeight: "bold" }}>
									Cline wants to search this directory for{" "}
									<code style={{ wordBreak: "break-all" }}>{tool.regex}</code>:
								</span>
							</div>
							<SearchResultsDisplay
								content={tool.content!}
								filePattern={tool.filePattern}
								isExpanded={isExpanded}
								onToggleExpand={handleToggle}
								path={tool.path!}
							/>
						</>
					)
				case "summarizeTask":
					return (
						<>
							<div style={headerStyle}>
								{toolIcon("book")}
								<span style={{ fontWeight: "bold" }}>Cline is condensing the conversation:</span>
							</div>
							<div
								style={{
									borderRadius: 3,
									backgroundColor: CODE_BLOCK_BG_COLOR,
									overflow: "hidden",
									border: "1px solid var(--vscode-editorGroup-border)",
								}}>
								<div
									onClick={handleToggle}
									style={{
										color: "var(--vscode-descriptionForeground)",
										padding: "9px 10px",
										cursor: "pointer",
										userSelect: "none",
										WebkitUserSelect: "none",
										MozUserSelect: "none",
										msUserSelect: "none",
									}}>
									{isExpanded ? (
										<div>
											<div style={{ display: "flex", alignItems: "center", marginBottom: "8px" }}>
												<span style={{ fontWeight: "bold", marginRight: "4px" }}>Summary:</span>
												<div style={{ flexGrow: 1 }}></div>
												<span
													className="codicon codicon-chevron-up"
													style={{
														fontSize: 13.5,
														margin: "1px 0",
													}}></span>
											</div>
											<span
												className="ph-no-capture"
												style={{
													whiteSpace: "pre-wrap",
													wordBreak: "break-word",
													overflowWrap: "anywhere",
												}}>
												{tool.content}
											</span>
										</div>
									) : (
										<div style={{ display: "flex", alignItems: "center" }}>
											<span
												className="ph-no-capture"
												style={{
													whiteSpace: "nowrap",
													overflow: "hidden",
													textOverflow: "ellipsis",
													marginRight: "8px",
													direction: "rtl",
													textAlign: "left",
													flex: 1,
												}}>
												{tool.content + "\u200E"}
											</span>
											<span
												className="codicon codicon-chevron-down"
												style={{
													fontSize: 13.5,
													margin: "1px 0",
													flexShrink: 0,
												}}></span>
										</div>
									)}
								</div>
							</div>
						</>
					)
				case "webFetch":
					return (
						<>
							<div style={headerStyle}>
								<span
									className="codicon codicon-link"
									style={{ color: normalColor, marginBottom: "-1.5px" }}></span>
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This URL is external")}
								<span style={{ fontWeight: "bold" }}>
									{message.type === "ask"
										? "Cline wants to fetch content from this URL:"
										: "Cline fetched content from this URL:"}
								</span>
							</div>
							<div
								onClick={() => {
									// Open the URL in the default browser using gRPC
									if (tool.path) {
										UiServiceClient.openUrl(StringRequest.create({ value: tool.path })).catch((err) => {
											console.error("Failed to open URL:", err)
										})
									}
								}}
								style={{
									borderRadius: 3,
									backgroundColor: CODE_BLOCK_BG_COLOR,
									overflow: "hidden",
									border: "1px solid var(--vscode-editorGroup-border)",
									padding: "9px 10px",
									cursor: "pointer",
									userSelect: "none",
									WebkitUserSelect: "none",
									MozUserSelect: "none",
									msUserSelect: "none",
								}}>
								<span
									className="ph-no-capture"
									style={{
										whiteSpace: "nowrap",
										overflow: "hidden",
										textOverflow: "ellipsis",
										marginRight: "8px",
										direction: "rtl",
										textAlign: "left",
										color: "var(--vscode-textLink-foreground)",
										textDecoration: "underline",
									}}>
									{tool.path + "\u200E"}
								</span>
							</div>
							{/* Displaying the 'content' which now holds "Fetching URL: [URL]" */}
							{/* <div style={{ paddingTop: 5, fontSize: '0.9em', opacity: 0.8 }}>{tool.content}</div> */}
						</>
					)
				default:
					return null
			}
		}

		if (message.ask === "command" || message.say === "command") {
			const splitMessage = (text: string) => {
				const outputIndex = text.indexOf(COMMAND_OUTPUT_STRING)
				if (outputIndex === -1) {
					return { command: text, output: "" }
				}
				return {
					command: text.slice(0, outputIndex).trim(),
					output: text
						.slice(outputIndex + COMMAND_OUTPUT_STRING.length)
						.trim()
						.split("")
						.map((char) => {
							switch (char) {
								case "\t":
									return "→   "
								case "\b":
									return "⌫"
								case "\f":
									return "⏏"
								case "\v":
									return "⇳"
								default:
									return char
							}
						})
						.join(""),
				}
			}

			const { command: rawCommand, output } = splitMessage(message.text || "")

			const requestsApproval = rawCommand.endsWith(COMMAND_REQ_APP_STRING)
			const command = requestsApproval ? rawCommand.slice(0, -COMMAND_REQ_APP_STRING.length) : rawCommand

			return (
				<>
					<div style={headerStyle}>
						{icon}
						{title}
					</div>
					<div
						style={{
							borderRadius: 3,
							border: "1px solid var(--vscode-editorGroup-border)",
							overflow: "hidden",
							backgroundColor: CODE_BLOCK_BG_COLOR,
						}}>
						<CodeBlock forceWrap={true} source={`${"```"}shell\n${command}\n${"```"}`} />
						{output.length > 0 && (
							<div style={{ width: "100%" }}>
								<div
									onClick={handleToggle}
									style={{
										display: "flex",
										alignItems: "center",
										gap: "4px",
										width: "100%",
										justifyContent: "flex-start",
										cursor: "pointer",
										padding: `2px 8px ${isExpanded ? 0 : 8}px 8px`,
									}}>
									<span className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`}></span>
									<span style={{ fontSize: "0.8em" }}>Command Output</span>
								</div>
								{isExpanded && <CodeBlock source={`${"```"}shell\n${output}\n${"```"}`} />}
							</div>
						)}
					</div>
					{requestsApproval && (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 10,
								padding: 8,
								fontSize: "12px",
								color: "var(--vscode-editorWarning-foreground)",
							}}>
							<i className="codicon codicon-warning"></i>
							<span>The model has determined this command requires explicit approval.</span>
						</div>
					)}
				</>
			)
		}

		if (message.ask === "use_mcp_server" || message.say === "use_mcp_server") {
			const useMcpServer = JSON.parse(message.text || "{}") as ClineAskUseMcpServer
			const server = mcpServers.find((server) => server.name === useMcpServer.serverName)
			return (
				<>
					<div style={headerStyle}>
						{icon}
						{title}
					</div>

					<div
						style={{
							background: "var(--vscode-textCodeBlock-background)",
							borderRadius: "3px",
							padding: "8px 10px",
							marginTop: "8px",
						}}>
						{useMcpServer.type === "access_mcp_resource" && (
							<McpResourceRow
								item={{
									...(findMatchingResourceOrTemplate(
										useMcpServer.uri || "",
										server?.resources,
										server?.resourceTemplates,
									) || {
										name: "",
										mimeType: "",
										description: "",
									}),
									uri: useMcpServer.uri || "",
								}}
							/>
						)}

						{useMcpServer.type === "use_mcp_tool" && (
							<>
								<div onClick={(e) => e.stopPropagation()}>
									<McpToolRow
										serverName={useMcpServer.serverName}
										tool={{
											name: useMcpServer.toolName || "",
											description:
												server?.tools?.find((tool) => tool.name === useMcpServer.toolName)?.description ||
												"",
											autoApprove:
												server?.tools?.find((tool) => tool.name === useMcpServer.toolName)?.autoApprove ||
												false,
										}}
									/>
								</div>
								{useMcpServer.arguments && useMcpServer.arguments !== "{}" && (
									<div style={{ marginTop: "8px" }}>
										<div
											style={{
												marginBottom: "4px",
												opacity: 0.8,
												fontSize: "12px",
												textTransform: "uppercase",
											}}>
											Arguments
										</div>
										<CodeAccordian
											code={useMcpServer.arguments}
											isExpanded={true}
											language="json"
											onToggleExpand={handleToggle}
										/>
									</div>
								)}
							</>
						)}
					</div>
				</>
			)
		}

		switch (message.type) {
			case "say":
				switch (message.say) {
					case "api_req_started":
						return (
							<>
								<div
									onClick={handleToggle}
									style={{
										...headerStyle,
										marginBottom:
											(cost == null && apiRequestFailedMessage) || apiReqStreamingFailedMessage ? 10 : 0,
										justifyContent: "space-between",
										cursor: "pointer",
										userSelect: "none",
										WebkitUserSelect: "none",
										MozUserSelect: "none",
										msUserSelect: "none",
									}}>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: "10px",
										}}>
										{icon}
										{title}
										{/* Need to render this every time since it affects height of row by 2px */}
										<VSCodeBadge
											style={{
												opacity: cost != null && cost > 0 ? 1 : 0,
											}}>
											${Number(cost || 0)?.toFixed(4)}
										</VSCodeBadge>
									</div>
									<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></span>
								</div>
								{((cost == null && apiRequestFailedMessage) || apiReqStreamingFailedMessage) && (
									<ErrorRow
										apiReqStreamingFailedMessage={apiReqStreamingFailedMessage}
										apiRequestFailedMessage={apiRequestFailedMessage}
										errorType="error"
										message={message}
									/>
								)}

								{isExpanded && (
									<div style={{ marginTop: "10px" }}>
										<CodeAccordian
											code={JSON.parse(message.text || "{}").request}
											isExpanded={true}
											language="markdown"
											onToggleExpand={handleToggle}
										/>
									</div>
								)}
							</>
						)
					case "api_req_finished":
						return null // we should never see this message type
					case "mcp_server_response":
						return <McpResponseDisplay responseText={message.text || ""} />
					case "mcp_notification":
						return (
							<div
								style={{
									display: "flex",
									alignItems: "flex-start",
									gap: "8px",
									padding: "8px 12px",
									backgroundColor: "var(--vscode-textBlockQuote-background)",
									borderRadius: "4px",
									fontSize: "13px",
									color: "var(--vscode-foreground)",
									opacity: 0.9,
									marginBottom: "8px",
								}}>
								<i
									className="codicon codicon-bell"
									style={{
										marginTop: "2px",
										fontSize: "14px",
										color: "var(--vscode-notificationsInfoIcon-foreground)",
										flexShrink: 0,
									}}
								/>
								<div style={{ flex: 1, wordBreak: "break-word" }}>
									<span style={{ fontWeight: 500 }}>MCP Notification: </span>
									<span className="ph-no-capture">{message.text}</span>
								</div>
							</div>
						)
					case "text":
						return (
							<WithCopyButton
								onMouseUp={handleMouseUp}
								position="bottom-right"
								ref={contentRef}
								textToCopy={message.text}>
								<Markdown markdown={message.text} />
								{quoteButtonState.visible && (
									<QuoteButton
										left={quoteButtonState.left}
										onClick={() => {
											handleQuoteClick()
										}}
										top={quoteButtonState.top}
									/>
								)}
							</WithCopyButton>
						)
					case "reasoning":
						return (
							<>
								{message.text && (
									<div
										onClick={handleToggle}
										style={{
											// marginBottom: 15,
											cursor: "pointer",
											color: "var(--vscode-descriptionForeground)",

											fontStyle: "italic",
											overflow: "hidden",
										}}>
										{isExpanded ? (
											<div style={{ marginTop: -3 }}>
												<span style={{ fontWeight: "bold", display: "block", marginBottom: "4px" }}>
													Thinking
													<span
														className="codicon codicon-chevron-down"
														style={{
															display: "inline-block",
															transform: "translateY(3px)",
															marginLeft: "1.5px",
														}}
													/>
												</span>
												<span className="ph-no-capture">{message.text}</span>
											</div>
										) : (
											<div style={{ display: "flex", alignItems: "center" }}>
												<span style={{ fontWeight: "bold", marginRight: "4px" }}>Thinking:</span>
												<span
													className="ph-no-capture"
													style={{
														whiteSpace: "nowrap",
														overflow: "hidden",
														textOverflow: "ellipsis",
														direction: "rtl",
														textAlign: "left",
														flex: 1,
													}}>
													{message.text + "\u200E"}
												</span>
												<span
													className="codicon codicon-chevron-right"
													style={{
														marginLeft: "4px",
														flexShrink: 0,
													}}
												/>
											</div>
										)}
									</div>
								)}
							</>
						)
					case "user_feedback":
						return (
							<UserMessage
								files={message.files}
								images={message.images}
								messageTs={message.ts}
								sendMessageFromChatRow={sendMessageFromChatRow}
								text={message.text}
							/>
						)
					case "user_feedback_diff":
						const tool = JSON.parse(message.text || "{}") as ClineSayTool
						return (
							<div
								style={{
									marginTop: -10,
									width: "100%",
								}}>
								<CodeAccordian
									diff={tool.diff!}
									isExpanded={isExpanded}
									isFeedback={true}
									onToggleExpand={handleToggle}
								/>
							</div>
						)
					case "error":
						return <ErrorRow errorType="error" message={message} />
					case "diff_error":
						return <ErrorRow errorType="diff_error" message={message} />
					case "clineignore_error":
						return <ErrorRow errorType="clineignore_error" message={message} />
					case "checkpoint_created":
						return <CheckmarkControl isCheckpointCheckedOut={message.isCheckpointCheckedOut} messageTs={message.ts} />
					case "load_mcp_documentation":
						return (
							<div
								style={{
									display: "flex",
									alignItems: "center",
									color: "var(--vscode-foreground)",
									opacity: 0.7,
									fontSize: 12,
									padding: "4px 0",
								}}>
								<i className="codicon codicon-book" style={{ marginRight: 6 }} />
								Loading MCP documentation
							</div>
						)
					case "completion_result":
						const hasChanges = message.text?.endsWith(COMPLETION_RESULT_CHANGES_FLAG) ?? false
						const text = hasChanges ? message.text?.slice(0, -COMPLETION_RESULT_CHANGES_FLAG.length) : message.text
						return (
							<>
								<div
									style={{
										...headerStyle,
										marginBottom: "10px",
									}}>
									{icon}
									{title}
									{/* <TaskFeedbackButtons
										isFromHistory={
											!isLast ||
											lastModifiedMessage?.ask === "resume_completed_task" ||
											lastModifiedMessage?.ask === "resume_task"
										}
										messageTs={message.ts}
										style={{
											marginLeft: "auto",
										}}
									/> */}
								</div>
								<WithCopyButton
									onMouseUp={handleMouseUp}
									position="bottom-right"
									ref={contentRef}
									style={{
										color: "var(--vscode-charts-green)",
										paddingTop: 10,
									}}
									textToCopy={text}>
									<Markdown markdown={text} />
									{quoteButtonState.visible && (
										<QuoteButton
											left={quoteButtonState.left}
											onClick={handleQuoteClick}
											top={quoteButtonState.top}
										/>
									)}
								</WithCopyButton>
								{message.partial !== true && hasChanges && (
									<div style={{ paddingTop: 17 }}>
										<SuccessButton
											disabled={seeNewChangesDisabled}
											onClick={() => {
												setSeeNewChangesDisabled(true)
												TaskServiceClient.taskCompletionViewChanges(
													Int64Request.create({
														value: message.ts,
													}),
												).catch((err) =>
													console.error("Failed to show task completion view changes:", err),
												)
											}}
											style={{
												cursor: seeNewChangesDisabled ? "wait" : "pointer",
												width: "100%",
											}}>
											<i className="codicon codicon-new-file" style={{ marginRight: 6 }} />
											See new changes
										</SuccessButton>
									</div>
								)}
							</>
						)
					case "shell_integration_warning":
						return (
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									backgroundColor: "var(--vscode-textBlockQuote-background)",
									padding: 8,
									borderRadius: 3,
									fontSize: 12,
								}}>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										marginBottom: 4,
									}}>
									<i
										className="codicon codicon-warning"
										style={{
											marginRight: 8,
											fontSize: 14,
											color: "var(--vscode-descriptionForeground)",
										}}></i>
									<span
										style={{
											fontWeight: 500,
											color: "var(--vscode-foreground)",
										}}>
										Shell Integration Unavailable
									</span>
								</div>
								<div style={{ color: "var(--vscode-foreground)", opacity: 0.8 }}>
									Cline may have trouble viewing the command's output. Please update VSCode (
									<code>CMD/CTRL + Shift + P</code> → "Update") and make sure you're using a supported shell:
									zsh, bash, fish, or PowerShell (<code>CMD/CTRL + Shift + P</code> → "Terminal: Select Default
									Profile").{" "}
									<a
										href="https://github.com/cline/cline/wiki/Troubleshooting-%E2%80%90-Shell-Integration-Unavailable"
										style={{
											color: "inherit",
											textDecoration: "underline",
										}}>
										Still having trouble?
									</a>
								</div>
							</div>
						)
					case "task_progress":
						return null // task_progress messages should be displayed in TaskHeader only, not in chat
					default:
						return (
							<>
								{title && (
									<div style={headerStyle}>
										{icon}
										{title}
									</div>
								)}
								<div style={{ paddingTop: 10 }}>
									<Markdown markdown={message.text} />
								</div>
							</>
						)
				}
			case "ask":
				switch (message.ask) {
					case "mistake_limit_reached":
						return <ErrorRow errorType="mistake_limit_reached" message={message} />
					case "auto_approval_max_req_reached":
						return <ErrorRow errorType="auto_approval_max_req_reached" message={message} />
					case "completion_result":
						if (message.text) {
							const hasChanges = message.text.endsWith(COMPLETION_RESULT_CHANGES_FLAG) ?? false
							const text = hasChanges ? message.text.slice(0, -COMPLETION_RESULT_CHANGES_FLAG.length) : message.text
							return (
								<div>
									<div
										style={{
											...headerStyle,
											marginBottom: "10px",
										}}>
										{icon}
										{title}
										<TaskFeedbackButtons
											isFromHistory={
												!isLast ||
												lastModifiedMessage?.ask === "resume_completed_task" ||
												lastModifiedMessage?.ask === "resume_task"
											}
											messageTs={message.ts}
											style={{
												marginLeft: "auto",
											}}
										/>
									</div>
									<WithCopyButton
										onMouseUp={handleMouseUp}
										position="bottom-right"
										ref={contentRef}
										style={{
											color: "var(--vscode-charts-green)",
											paddingTop: 10,
										}}
										textToCopy={text}>
										<Markdown markdown={text} />
										{quoteButtonState.visible && (
											<QuoteButton
												left={quoteButtonState.left}
												onClick={handleQuoteClick}
												top={quoteButtonState.top}
											/>
										)}
									</WithCopyButton>
									{message.partial !== true && hasChanges && (
										<div style={{ marginTop: 15 }}>
											<SuccessButton
												appearance="secondary"
												disabled={seeNewChangesDisabled}
												onClick={() => {
													setSeeNewChangesDisabled(true)
													TaskServiceClient.taskCompletionViewChanges(
														Int64Request.create({
															value: message.ts,
														}),
													).catch((err) =>
														console.error("Failed to show task completion view changes:", err),
													)
												}}>
												<i
													className="codicon codicon-new-file"
													style={{
														marginRight: 6,
														cursor: seeNewChangesDisabled ? "wait" : "pointer",
													}}
												/>
												See new changes
											</SuccessButton>
										</div>
									)}
								</div>
							)
						} else {
							return null // Don't render anything when we get a completion_result ask without text
						}
					case "followup":
						let question: string | undefined
						let options: string[] | undefined
						let selected: string | undefined
						try {
							const parsedMessage = JSON.parse(message.text || "{}") as ClineAskQuestion
							question = parsedMessage.question
							options = parsedMessage.options
							selected = parsedMessage.selected
						} catch (_e) {
							// legacy messages would pass question directly
							question = message.text
						}

						return (
							<>
								{title && (
									<div style={headerStyle}>
										{icon}
										{title}
									</div>
								)}
								<WithCopyButton
									onMouseUp={handleMouseUp}
									position="bottom-right"
									ref={contentRef}
									style={{ paddingTop: 10 }}
									textToCopy={question}>
									<Markdown markdown={question} />
									<OptionsButtons
										inputValue={inputValue}
										isActive={
											(isLast && lastModifiedMessage?.ask === "followup") ||
											(!selected && options && options.length > 0)
										}
										options={options}
										selected={selected}
									/>
									{quoteButtonState.visible && (
										<QuoteButton
											left={quoteButtonState.left}
											onClick={() => {
												handleQuoteClick()
											}}
											top={quoteButtonState.top}
										/>
									)}
								</WithCopyButton>
							</>
						)
					case "new_task":
						return (
							<>
								<div style={headerStyle}>
									<span
										className="codicon codicon-new-file"
										style={{
											color: normalColor,
											marginBottom: "-1.5px",
										}}></span>
									<span style={{ color: normalColor, fontWeight: "bold" }}>
										Cline wants to start a new task:
									</span>
								</div>
								<NewTaskPreview context={message.text || ""} />
							</>
						)
					case "condense":
						return (
							<>
								<div style={headerStyle}>
									<span
										className="codicon codicon-new-file"
										style={{
											color: normalColor,
											marginBottom: "-1.5px",
										}}></span>
									<span style={{ color: normalColor, fontWeight: "bold" }}>
										Cline wants to condense your conversation:
									</span>
								</div>
								<NewTaskPreview context={message.text || ""} />
							</>
						)
					case "report_bug":
						return (
							<>
								<div style={headerStyle}>
									<span
										className="codicon codicon-new-file"
										style={{
											color: normalColor,
											marginBottom: "-1.5px",
										}}></span>
									<span style={{ color: normalColor, fontWeight: "bold" }}>
										Cline wants to create a Github issue:
									</span>
								</div>
								<ReportBugPreview data={message.text || ""} />
							</>
						)
					case "plan_mode_respond": {
						let response: string | undefined
						let options: string[] | undefined
						let selected: string | undefined
						try {
							const parsedMessage = JSON.parse(message.text || "{}") as ClinePlanModeResponse
							response = parsedMessage.response
							options = parsedMessage.options
							selected = parsedMessage.selected
						} catch (_e) {
							// legacy messages would pass response directly
							response = message.text
						}
						return (
							<WithCopyButton
								onMouseUp={handleMouseUp}
								position="bottom-right"
								ref={contentRef}
								textToCopy={response}>
								<Markdown markdown={response} />
								<OptionsButtons
									inputValue={inputValue}
									isActive={
										(isLast && lastModifiedMessage?.ask === "plan_mode_respond") ||
										(!selected && options && options.length > 0)
									}
									options={options}
									selected={selected}
								/>
								{quoteButtonState.visible && (
									<QuoteButton
										left={quoteButtonState.left}
										onClick={() => {
											handleQuoteClick()
										}}
										top={quoteButtonState.top}
									/>
								)}
							</WithCopyButton>
						)
					}
					default:
						return null
				}
		}
	},
)

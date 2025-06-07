import { VSCodeBadge, VSCodeButton, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import deepEqual from "fast-deep-equal"
import React, { memo, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"

import CreditLimitError from "@/components/chat/CreditLimitError"
import { OptionsButtons } from "@/components/chat/OptionsButtons"
import TaskFeedbackButtons from "@/components/chat/TaskFeedbackButtons"
import { CheckmarkControl } from "@/components/common/CheckmarkControl"
import CodeBlock, { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import MarkdownBlock from "@/components/common/MarkdownBlock"
import SuccessButton from "@/components/common/SuccessButton"
import McpResponseDisplay from "@/components/mcp/chat-display/McpResponseDisplay"
import McpResourceRow from "@/components/mcp/configuration/tabs/installed/server-row/McpResourceRow"
import McpToolRow from "@/components/mcp/configuration/tabs/installed/server-row/McpToolRow"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient, TaskServiceClient } from "@/services/grpc-client"
import { findMatchingResourceOrTemplate, getMcpServerDisplayName } from "@/utils/mcp"
import { vscode } from "@/utils/vscode"
import {
	ClineApiReqInfo,
	ClineAskQuestion,
	ClineAskUseMcpServer,
	ClineMessage,
	ClinePlanModeResponse,
	ClineSayTool,
	COMPLETION_RESULT_CHANGES_FLAG,
	ExtensionMessage,
} from "@shared/ExtensionMessage"
import { COMMAND_OUTPUT_STRING, COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { Int64Request, StringRequest } from "@shared/proto/common"
import { useEvent, useSize } from "react-use"
import styled from "styled-components"
import { CheckpointControls } from "../common/CheckpointControls"
import CodeAccordian, { cleanPathPrefix } from "../common/CodeAccordian"
import NewTaskPreview from "./NewTaskPreview"
import QuoteButton from "./QuoteButton"
import ReportBugPreview from "./ReportBugPreview"
import UserMessage from "./UserMessage"

interface CopyButtonProps {
	textToCopy: string | undefined
}

const normalColor = "var(--vscode-foreground)"
const errorColor = "var(--vscode-errorForeground)"
const successColor = "var(--vscode-charts-green)"
const cancelledColor = "var(--vscode-descriptionForeground)"

const CopyButtonStyled = styled(VSCodeButton)`
	position: absolute;
	bottom: 2px;
	right: 2px;
	z-index: 1;
	opacity: 0;
`

interface WithCopyButtonProps {
	children: React.ReactNode
	textToCopy?: string
	style?: React.CSSProperties
	ref?: React.Ref<HTMLDivElement>
	onMouseUp?: (event: MouseEvent<HTMLDivElement>) => void
}

const StyledContainer = styled.div`
	position: relative;

	&:hover ${CopyButtonStyled} {
		opacity: 1;
	}
`

const WithCopyButton = React.forwardRef<HTMLDivElement, WithCopyButtonProps>(
	({ children, textToCopy, style, onMouseUp, ...props }, ref) => {
		const [copied, setCopied] = useState(false)

		const handleCopy = () => {
			if (!textToCopy) return

			navigator.clipboard.writeText(textToCopy).then(() => {
				setCopied(true)
				setTimeout(() => {
					setCopied(false)
				}, 1500)
			})
		}

		return (
			<StyledContainer ref={ref} onMouseUp={onMouseUp} style={style} {...props}>
				{children}
				{textToCopy && (
					<CopyButtonStyled appearance="icon" onClick={handleCopy} aria-label={copied ? "Copied" : "Copy"}>
						<span className={`codicon codicon-${copied ? "check" : "copy"}`}></span>
					</CopyButtonStyled>
				)}
			</StyledContainer>
		)
	},
)

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
	onToggleExpand: () => void
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

const RetryMessage = ({ seconds, attempt, retryOperations }: { retryOperations: number; attempt: number; seconds?: number }) => {
	const [remainingSeconds, setRemainingSeconds] = useState(seconds || 0)

	useEffect(() => {
		if (seconds && seconds > 0) {
			setRemainingSeconds(seconds)

			const interval = setInterval(() => {
				setRemainingSeconds((prev) => {
					if (prev <= 1) {
						clearInterval(interval)
						return 0
					}
					return prev - 1
				})
			}, 1000)

			return () => clearInterval(interval)
		}
	}, [seconds])

	return (
		<span
			style={{
				color: normalColor,
				fontWeight: "bold",
			}}>
			{`API Request (Retrying failed attempt ${attempt}/${retryOperations}`}
			{remainingSeconds > 0 && ` in ${remainingSeconds} seconds`}
			)...
		</span>
	)
}

const ChatRow = memo(
	(props: ChatRowProps) => {
		const { isLast, onHeightChange, message, lastModifiedMessage, inputValue } = props
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

export const ChatRowContent = ({
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
		return [undefined, undefined, undefined, undefined]
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
					<span className="ph-no-capture" style={{ color: normalColor, fontWeight: "bold", wordBreak: "break-word" }}>
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
				const getIconSpan = (iconName: string, color: string) => (
					<div
						style={{
							width: 16,
							height: 16,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
						}}>
						<span
							className={`codicon codicon-${iconName}`}
							style={{
								color,
								fontSize: 16,
								marginBottom: "-1.5px",
							}}></span>
					</div>
				)
				return [
					apiReqCancelReason != null ? (
						apiReqCancelReason === "user_cancelled" ? (
							getIconSpan("error", cancelledColor)
						) : (
							getIconSpan("error", errorColor)
						)
					) : cost != null ? (
						getIconSpan("check", successColor)
					) : apiRequestFailedMessage ? (
						getIconSpan("error", errorColor)
					) : (
						<ProgressIndicator />
					),
					(() => {
						if (apiReqCancelReason != null) {
							return apiReqCancelReason === "user_cancelled" ? (
								<span style={{ color: normalColor, fontWeight: "bold" }}>API Request Cancelled</span>
							) : (
								<span style={{ color: errorColor, fontWeight: "bold" }}>API Streaming Failed</span>
							)
						}

						if (cost != null) {
							return <span style={{ color: normalColor, fontWeight: "bold" }}>API Request</span>
						}

						if (apiRequestFailedMessage) {
							return <span style={{ color: errorColor, fontWeight: "bold" }}>API Request Failed</span>
						}
						// New: Check for retryStatus to modify the title
						if (retryStatus && cost == null && !apiReqCancelReason) {
							const retryOperations = retryStatus.maxAttempts > 0 ? retryStatus.maxAttempts - 1 : 0
							return (
								<RetryMessage
									seconds={retryStatus.delaySec}
									attempt={retryStatus.attempt}
									retryOperations={retryOperations}
								/>
							)
						}

						return <span style={{ color: normalColor, fontWeight: "bold" }}>API Request...</span>
					})(),
				]
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

	const pStyle: React.CSSProperties = {
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
							path={tool.path!}
							isExpanded={isExpanded}
							onToggleExpand={onToggleExpand}
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
							isLoading={message.partial}
							code={tool.content!}
							path={tool.path!}
							isExpanded={isExpanded}
							onToggleExpand={onToggleExpand}
						/>
					</>
				)
			case "readFile":
				return (
					<>
						<div style={headerStyle}>
							{toolIcon("file-code")}
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
								style={{
									color: "var(--vscode-descriptionForeground)",
									display: "flex",
									alignItems: "center",
									padding: "9px 10px",
									cursor: "pointer",
									userSelect: "none",
									WebkitUserSelect: "none",
									MozUserSelect: "none",
									msUserSelect: "none",
								}}
								onClick={() => {
									FileServiceClient.openFile(StringRequest.create({ value: tool.content })).catch((err) =>
										console.error("Failed to open file:", err),
									)
								}}>
								{tool.path?.startsWith(".") && <span>.</span>}
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
								<span
									className={`codicon codicon-link-external`}
									style={{
										fontSize: 13.5,
										margin: "1px 0",
									}}></span>
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
							path={tool.path!}
							language="shell-session"
							isExpanded={isExpanded}
							onToggleExpand={onToggleExpand}
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
							path={tool.path!}
							language="shell-session"
							isExpanded={isExpanded}
							onToggleExpand={onToggleExpand}
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
							path={tool.path!}
							isExpanded={isExpanded}
							onToggleExpand={onToggleExpand}
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
								Cline wants to search this directory for <code>{tool.regex}</code>:
							</span>
						</div>
						<CodeAccordian
							code={tool.content!}
							path={tool.path! + (tool.filePattern ? `/(${tool.filePattern})` : "")}
							language="plaintext"
							isExpanded={isExpanded}
							onToggleExpand={onToggleExpand}
						/>
					</>
				)
			case "webFetch":
				return (
					<>
						<div style={headerStyle}>
							<span className="codicon codicon-link" style={{ color: normalColor, marginBottom: "-1.5px" }}></span>
							{tool.operationIsLocatedInWorkspace === false &&
								toolIcon("sign-out", "yellow", -90, "This URL is external")}
							<span style={{ fontWeight: "bold" }}>
								{message.type === "ask"
									? "Cline wants to fetch content from this URL:"
									: "Cline fetched content from this URL:"}
							</span>
						</div>
						<div
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
							}}
							onClick={() => {
								// Attempt to open the URL in the default browser
								if (tool.path) {
									// Assuming 'openUrl' is a valid action the extension can handle.
									// If not, this might need adjustment based on how other external link openings are handled.
									vscode.postMessage({
										type: "action", // This should be a valid MessageType from WebviewMessage
										action: "openUrl", // This should be a valid WebviewAction from WebviewMessage
										url: tool.path,
									} as any) // Using 'as any' for now if 'openUrl' isn't strictly typed yet
								}
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
					<CodeBlock source={`${"```"}shell\n${command}\n${"```"}`} forceWrap={true} />
					{output.length > 0 && (
						<div style={{ width: "100%" }}>
							<div
								onClick={onToggleExpand}
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
									tool={{
										name: useMcpServer.toolName || "",
										description:
											server?.tools?.find((tool) => tool.name === useMcpServer.toolName)?.description || "",
										autoApprove:
											server?.tools?.find((tool) => tool.name === useMcpServer.toolName)?.autoApprove ||
											false,
									}}
									serverName={useMcpServer.serverName}
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
										language="json"
										isExpanded={true}
										onToggleExpand={onToggleExpand}
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
								}}
								onClick={onToggleExpand}>
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
								<>
									{(() => {
										// Try to parse the error message as JSON for credit limit error
										const errorData = parseErrorText(apiRequestFailedMessage)
										if (errorData) {
											if (
												errorData.code === "insufficient_credits" &&
												typeof errorData.current_balance === "number" &&
												typeof errorData.total_spent === "number" &&
												typeof errorData.total_promotions === "number" &&
												typeof errorData.message === "string"
											) {
												return (
													<CreditLimitError
														currentBalance={errorData.current_balance}
														totalSpent={errorData.total_spent}
														totalPromotions={errorData.total_promotions}
														message={errorData.message}
													/>
												)
											}
										}

										// Default error display
										return (
											<p
												style={{
													...pStyle,
													color: "var(--vscode-errorForeground)",
												}}>
												{apiRequestFailedMessage || apiReqStreamingFailedMessage}
												{apiRequestFailedMessage?.toLowerCase().includes("powershell") && (
													<>
														<br />
														<br />
														It seems like you're having Windows PowerShell issues, please see this{" "}
														<a
															href="https://github.com/cline/cline/wiki/TroubleShooting-%E2%80%90-%22PowerShell-is-not-recognized-as-an-internal-or-external-command%22"
															style={{
																color: "inherit",
																textDecoration: "underline",
															}}>
															troubleshooting guide
														</a>
														.
													</>
												)}
											</p>
										)
									})()}
								</>
							)}

							{isExpanded && (
								<div style={{ marginTop: "10px" }}>
									<CodeAccordian
										code={JSON.parse(message.text || "{}").request}
										language="markdown"
										isExpanded={true}
										onToggleExpand={onToggleExpand}
									/>
								</div>
							)}
						</>
					)
				case "api_req_finished":
					return null // we should never see this message type
				case "mcp_server_response":
					return <McpResponseDisplay responseText={message.text || ""} />
				case "text":
					return (
						<WithCopyButton ref={contentRef} onMouseUp={handleMouseUp} textToCopy={message.text}>
							<Markdown markdown={message.text} />
							{quoteButtonState.visible && (
								<QuoteButton
									top={quoteButtonState.top}
									left={quoteButtonState.left}
									onClick={() => {
										handleQuoteClick()
									}}
								/>
							)}
						</WithCopyButton>
					)
				case "reasoning":
					return (
						<>
							{message.text && (
								<div
									onClick={onToggleExpand}
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
							text={message.text}
							images={message.images}
							files={message.files}
							messageTs={message.ts}
							sendMessageFromChatRow={sendMessageFromChatRow}
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
								isFeedback={true}
								isExpanded={isExpanded}
								onToggleExpand={onToggleExpand}
							/>
						</div>
					)
				case "error":
					return (
						<>
							{title && (
								<div style={headerStyle}>
									{icon}
									{title}
								</div>
							)}
							<p
								style={{
									...pStyle,
									color: "var(--vscode-errorForeground)",
								}}>
								{message.text}
							</p>
						</>
					)
				case "diff_error":
					return (
						<>
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									backgroundColor: "var(--vscode-textBlockQuote-background)",
									padding: 8,
									borderRadius: 3,
									fontSize: 12,
									color: "var(--vscode-foreground)",
									opacity: 0.8,
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
									<span style={{ fontWeight: 500 }}>Diff Edit Mismatch</span>
								</div>
								<div>The model used search patterns that don't match anything in the file. Retrying...</div>
							</div>
						</>
					)
				case "clineignore_error":
					return (
						<>
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									backgroundColor: "rgba(255, 191, 0, 0.1)",
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
										className="codicon codicon-error"
										style={{
											marginRight: 8,
											fontSize: 18,
											color: "#FFA500",
										}}></i>
									<span
										style={{
											fontWeight: 500,
											color: "#FFA500",
										}}>
										Access Denied
									</span>
								</div>
								<div>
									Cline tried to access <code>{message.text}</code> which is blocked by the{" "}
									<code>.clineignore</code>
									file.
								</div>
							</div>
						</>
					)
				case "checkpoint_created":
					return (
						<>
							<CheckmarkControl messageTs={message.ts} isCheckpointCheckedOut={message.isCheckpointCheckedOut} />
						</>
					)
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
								<TaskFeedbackButtons
									messageTs={message.ts}
									isFromHistory={
										!isLast ||
										lastModifiedMessage?.ask === "resume_completed_task" ||
										lastModifiedMessage?.ask === "resume_task"
									}
									style={{
										marginLeft: "auto",
									}}
								/>
							</div>
							<WithCopyButton
								ref={contentRef}
								onMouseUp={handleMouseUp}
								textToCopy={text}
								style={{
									color: "var(--vscode-charts-green)",
									paddingTop: 10,
								}}>
								<Markdown markdown={text} />
								{quoteButtonState.visible && (
									<QuoteButton
										top={quoteButtonState.top}
										left={quoteButtonState.left}
										onClick={handleQuoteClick}
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
											).catch((err) => console.error("Failed to show task completion view changes:", err))
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
						<>
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									backgroundColor: "rgba(255, 191, 0, 0.1)",
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
											fontSize: 18,
											color: "#FFA500",
										}}></i>
									<span
										style={{
											fontWeight: 500,
											color: "#FFA500",
										}}>
										Shell Integration Unavailable
									</span>
								</div>
								<div>
									Cline won't be able to view the command's output. Please update VSCode (
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
						</>
					)
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
					return (
						<>
							<div style={headerStyle}>
								{icon}
								{title}
							</div>
							<p
								style={{
									...pStyle,
									color: "var(--vscode-errorForeground)",
								}}>
								{message.text}
							</p>
						</>
					)
				case "auto_approval_max_req_reached":
					return (
						<>
							<div style={headerStyle}>
								{icon}
								{title}
							</div>
							<p
								style={{
									...pStyle,
									color: "var(--vscode-errorForeground)",
								}}>
								{message.text}
							</p>
						</>
					)
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
										messageTs={message.ts}
										isFromHistory={
											!isLast ||
											lastModifiedMessage?.ask === "resume_completed_task" ||
											lastModifiedMessage?.ask === "resume_task"
										}
										style={{
											marginLeft: "auto",
										}}
									/>
								</div>
								<WithCopyButton
									ref={contentRef}
									onMouseUp={handleMouseUp}
									textToCopy={text}
									style={{
										color: "var(--vscode-charts-green)",
										paddingTop: 10,
									}}>
									<Markdown markdown={text} />
									{quoteButtonState.visible && (
										<QuoteButton
											top={quoteButtonState.top}
											left={quoteButtonState.left}
											onClick={handleQuoteClick}
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
					} catch (e) {
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
								ref={contentRef}
								onMouseUp={handleMouseUp}
								textToCopy={question}
								style={{ paddingTop: 10 }}>
								<Markdown markdown={question} />
								<OptionsButtons
									options={options}
									selected={selected}
									isActive={isLast && lastModifiedMessage?.ask === "followup"}
									inputValue={inputValue}
								/>
								{quoteButtonState.visible && (
									<QuoteButton
										top={quoteButtonState.top}
										left={quoteButtonState.left}
										onClick={() => {
											handleQuoteClick()
										}}
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
								<span style={{ color: normalColor, fontWeight: "bold" }}>Cline wants to start a new task:</span>
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
					} catch (e) {
						// legacy messages would pass response directly
						response = message.text
					}
					return (
						<WithCopyButton ref={contentRef} onMouseUp={handleMouseUp} textToCopy={response}>
							<Markdown markdown={response} />
							<OptionsButtons
								options={options}
								selected={selected}
								isActive={isLast && lastModifiedMessage?.ask === "plan_mode_respond"}
								inputValue={inputValue}
							/>
							{quoteButtonState.visible && (
								<QuoteButton
									top={quoteButtonState.top}
									left={quoteButtonState.left}
									onClick={() => {
										handleQuoteClick()
									}}
								/>
							)}
						</WithCopyButton>
					)
				}
				default:
					return null
			}
	}
}

function parseErrorText(text: string | undefined) {
	if (!text) {
		return undefined
	}
	try {
		const startIndex = text.indexOf("{")
		const endIndex = text.lastIndexOf("}")
		if (startIndex !== -1 && endIndex !== -1) {
			const jsonStr = text.substring(startIndex, endIndex + 1)
			const errorObject = JSON.parse(jsonStr)
			return errorObject
		}
	} catch (e) {
		// Not JSON or missing required fields
	}
}

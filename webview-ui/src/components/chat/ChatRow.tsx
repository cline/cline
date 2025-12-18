import { COMMAND_OUTPUT_STRING, COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import {
	ClineApiReqInfo,
	ClineAskQuestion,
	ClineAskUseMcpServer,
	ClineMessage,
	ClinePlanModeResponse,
	ClineSayGenerateExplanation,
	ClineSayTool,
	COMPLETION_RESULT_CHANGES_FLAG,
} from "@shared/ExtensionMessage"
import { BooleanRequest, Int64Request, StringRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import deepEqual from "fast-deep-equal"
import { Brain, FoldVerticalIcon } from "lucide-react"
import React, { MouseEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSize } from "react-use"
import styled from "styled-components"
import { OptionsButtons } from "@/components/chat/OptionsButtons"
import TaskFeedbackButtons from "@/components/chat/TaskFeedbackButtons"
import "./ChatRow.css"
import { CheckmarkControl } from "@/components/common/CheckmarkControl"
import { CheckpointControls } from "@/components/common/CheckpointControls"
import CodeBlock, {
	CHAT_ROW_EXPANDED_BG_COLOR,
	CODE_BLOCK_BG_COLOR,
	TERMINAL_CODE_BLOCK_BG_COLOR,
} from "@/components/common/CodeBlock"
import { CopyButton, WithCopyButton } from "@/components/common/CopyButton"
import MarkdownBlock from "@/components/common/MarkdownBlock"
import McpResponseDisplay from "@/components/mcp/chat-display/McpResponseDisplay"
import McpResourceRow from "@/components/mcp/configuration/tabs/installed/server-row/McpResourceRow"
import McpToolRow from "@/components/mcp/configuration/tabs/installed/server-row/McpToolRow"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient, TaskServiceClient, UiServiceClient } from "@/services/grpc-client"
import { findMatchingResourceOrTemplate, getMcpServerDisplayName } from "@/utils/mcp"
import CodeAccordian, { cleanPathPrefix } from "../common/CodeAccordian"
import { findApiReqInfoForCheckpoint, findNextSegmentCost } from "./chat-view/utils/messageUtils"
import ErrorRow from "./ErrorRow"
import HookMessage from "./HookMessage"
import NewTaskPreview from "./NewTaskPreview"
import QuoteButton from "./QuoteButton"
import ReportBugPreview from "./ReportBugPreview"
import SearchResultsDisplay from "./SearchResultsDisplay"
import UserMessage from "./UserMessage"

const normalColor = "var(--vscode-foreground)"
const errorColor = "var(--vscode-errorForeground)"
const successColor = "var(--vscode-charts-green)"
const _cancelledColor = "var(--vscode-descriptionForeground)"

// Shared keyframes for cursor blink animation
const cursorBlinkKeyframes = `
	@keyframes cursorBlink {
		0%, 100% { opacity: 1; }
		50% { opacity: 0; }
	}
`

const ChatRowContainer = styled.div`
	${cursorBlinkKeyframes}
	padding: 10px 6px 10px 15px;
	position: relative;

	&:hover ${CheckpointControls} {
		opacity: 1;
	}

	/* Fade-in animation for hook messages being inserted */
	&.hook-message-animate {
		animation: hookFadeSlideIn 0.6s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes hookFadeSlideIn {
		from {
			opacity: 0;
			transform: translateY(-12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
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
	onCancelCommand?: () => void
	mode?: Mode
	reasoningContent?: string
	responseStarted?: boolean
	isRequestInProgress?: boolean
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

const BlinkingCursorSpan = styled.span`
	display: inline-block;
	width: 2px;
	height: 1em;
	background-color: currentColor;
	margin-left: 2px;
	vertical-align: text-bottom;
	animation: cursorBlink 1s ease-in-out infinite;
`

const BlinkingCursor = () => <BlinkingCursorSpan />

const TypewriterText = memo(({ text }: { text: string }) => {
	const [displayedLength, setDisplayedLength] = useState(0)

	useEffect(() => {
		setDisplayedLength(0)
		const interval = setInterval(() => {
			setDisplayedLength((prev) => {
				if (prev >= text.length) {
					clearInterval(interval)
					return prev
				}
				return prev + 1
			})
		}, 30)

		return () => clearInterval(interval)
	}, [text])

	return (
		<>
			{text.slice(0, displayedLength)}
			<BlinkingCursor />
		</>
	)
})

const ThinkingBlockContainer = styled.div<{ $isVisible: boolean; $instant?: boolean }>`
	display: flex;
	align-items: flex-start;
	gap: 8px;
	max-height: ${(props) => (props.$isVisible ? "150px" : "0")};
	opacity: ${(props) => (props.$isVisible ? 1 : 0)};
	overflow: hidden;
	transition: ${(props) => (props.$instant ? "none" : "max-height 250ms cubic-bezier(0.4, 0, 0.2, 1), opacity 150ms ease-out")};
	width: 100%;
	min-width: 0;
`

const ThinkingBlockScroll = styled.div`
	max-height: 150px;
	overflow-y: auto;
	color: var(--vscode-descriptionForeground);
	line-height: 1.5;
	white-space: pre-wrap;
	word-break: break-word;
	flex: 1;
	scrollbar-width: none;
	-ms-overflow-style: none;
	&::-webkit-scrollbar {
		display: none;
	}
`

// State type for api_req_started rendering
type ApiReqState = "pre" | "thinking" | "error" | "final"

const ThinkingBlock = memo(
	({
		reasoningContent,
		isVisible,
		showCursor = true,
		showIcon = true,
		instant = false,
	}: {
		reasoningContent?: string
		isVisible: boolean
		showCursor?: boolean
		showIcon?: boolean
		instant?: boolean
	}) => {
		const scrollRef = useRef<HTMLDivElement>(null)
		const [shouldRender, setShouldRender] = useState(isVisible)

		// Only auto-scroll to bottom during streaming (showCursor=true)
		// For expanded collapsed thinking, start at top
		useEffect(() => {
			if (scrollRef.current && isVisible && showCursor) {
				scrollRef.current.scrollTop = scrollRef.current.scrollHeight
			}
		}, [reasoningContent, isVisible, showCursor])

		useEffect(() => {
			if (isVisible) {
				setShouldRender(true)
			} else if (instant) {
				// Instant unmount for streaming thinking - no delay
				setShouldRender(false)
			} else {
				// Delayed unmount for user-toggled expanded thinking (animation)
				const timer = setTimeout(() => setShouldRender(false), 250)
				return () => clearTimeout(timer)
			}
		}, [isVisible, instant])

		if (!shouldRender) return null

		return (
			<ThinkingBlockContainer $instant={instant} $isVisible={isVisible}>
				{showIcon && (
					<Brain
						size={14}
						style={{
							color: "var(--vscode-descriptionForeground)",
							opacity: 0.7,
							flexShrink: 0,
							marginTop: 2,
						}}
					/>
				)}
				<ThinkingBlockScroll ref={scrollRef}>
					{reasoningContent}
					{isVisible && showCursor && <BlinkingCursor />}
				</ThinkingBlockScroll>
			</ThinkingBlockContainer>
		)
	},
)

const Markdown = memo(({ markdown, showCursor }: { markdown?: string; showCursor?: boolean }) => {
	return (
		<div
			style={{
				wordBreak: "break-word",
				overflowWrap: "anywhere",
				marginBottom: -15,
				marginTop: -15,
				overflow: "hidden", // contain child margins so that parent diff matches height of children
			}}>
			<MarkdownBlock markdown={markdown} showCursor={showCursor} />
		</div>
	)
})

const CommandOutput = memo(
	({
		output,
		isOutputFullyExpanded,
		onToggle,
		isContainerExpanded,
		borderColor = "var(--vscode-editorGroup-border)",
	}: {
		output: string
		isOutputFullyExpanded: boolean
		onToggle: () => void
		isContainerExpanded: boolean
		borderColor?: string
	}) => {
		const outputLines = output.split("\n")
		const lineCount = outputLines.length
		const shouldAutoShow = lineCount <= 5
		const outputRef = useRef<HTMLDivElement>(null)

		// Auto-scroll to bottom when output changes (only when showing limited output)
		useEffect(() => {
			if (!isOutputFullyExpanded && outputRef.current) {
				// Direct scrollTop manipulation
				outputRef.current.scrollTop = outputRef.current.scrollHeight

				// Another attempt with more delay (for slower renders) to ensure scrolling works
				setTimeout(() => {
					if (outputRef.current) {
						outputRef.current.scrollTop = outputRef.current.scrollHeight
					}
				}, 50)
			}
		}, [output, isOutputFullyExpanded])

		// Don't render anything if container is collapsed
		if (!isContainerExpanded) {
			return null
		}

		return (
			<div
				style={{
					width: "100%",
					position: "relative",
					paddingBottom: lineCount > 5 ? "16px" : "0",
					overflow: "visible",
					borderTop: "1px solid rgba(255,255,255,.07)",
					borderBottomLeftRadius: "6px",
					borderBottomRightRadius: "6px",
					backgroundColor: CHAT_ROW_EXPANDED_BG_COLOR,
				}}>
				<div
					ref={outputRef}
					style={{
						color: "#FFFFFF",
						maxHeight: shouldAutoShow ? "none" : isOutputFullyExpanded ? "200px" : "75px",
						overflowY: shouldAutoShow ? "visible" : "auto",
						scrollBehavior: "smooth",
						backgroundColor: TERMINAL_CODE_BLOCK_BG_COLOR,
					}}>
					<div style={{ backgroundColor: TERMINAL_CODE_BLOCK_BG_COLOR }}>
						<CodeBlock forceWrap={true} source={`${"```"}shell\n${output}\n${"```"}`} />
					</div>
				</div>
				{/* Show notch only if there's more than 5 lines */}
				{lineCount > 5 && (
					<div
						onClick={onToggle}
						style={{
							position: "absolute",
							bottom: "-8px",
							left: "50%",
							transform: "translateX(-50%)",
							display: "flex",
							justifyContent: "center",
							alignItems: "center",
							padding: "1px 14px",
							cursor: "pointer",
							backgroundColor: borderColor,
							borderRadius: "2px",
							border: "none",
						}}>
						<span
							className={`codicon codicon-triangle-${isOutputFullyExpanded ? "up" : "down"}`}
							style={{
								fontSize: "11px",
								color: "#000000",
							}}
						/>
					</div>
				)}
			</div>
		)
	},
)

const CompletionOutput = memo(
	({
		text,
		isOutputFullyExpanded,
		onToggle,
		borderColor = successColor,
	}: {
		text: string
		isOutputFullyExpanded: boolean
		onToggle: () => void
		borderColor?: string
	}) => {
		const outputLines = text.split("\n")
		const lineCount = outputLines.length
		const shouldAutoShow = lineCount <= 5

		return (
			<div
				style={{
					width: "100%",
					position: "relative",
					paddingBottom: lineCount > 5 ? "8px" : "0",
					overflow: "visible",
					borderTop: "1px solid rgba(255,255,255,.07)",
					borderBottomLeftRadius: "6px",
					borderBottomRightRadius: "6px",
					backgroundColor: CHAT_ROW_EXPANDED_BG_COLOR,
				}}>
				<div
					className="completion-output-content"
					style={{
						maxHeight: shouldAutoShow ? "none" : isOutputFullyExpanded ? "400px" : "150px",
						overflowY: shouldAutoShow ? "visible" : "auto",
						scrollBehavior: "smooth",
						padding: "12px",
					}}>
					<Markdown markdown={text} />
				</div>
				{/* Show notch only if there's more than 5 lines */}
				{lineCount > 5 && (
					<div
						onClick={onToggle}
						style={{
							position: "absolute",
							bottom: "-8px",
							left: "50%",
							transform: "translateX(-50%)",
							display: "flex",
							justifyContent: "center",
							alignItems: "center",
							padding: "1px 14px",
							cursor: "pointer",
							backgroundColor: borderColor,
							borderRadius: "2px",
							border: "none",
						}}>
						<span
							className={`codicon codicon-triangle-${isOutputFullyExpanded ? "up" : "down"}`}
							style={{
								fontSize: "11px",
								color: "#000000",
							}}
						/>
					</div>
				)}
			</div>
		)
	},
)

const ChatRow = memo(
	(props: ChatRowProps) => {
		const { isLast, onHeightChange, message } = props
		// Store the previous height to compare with the current height
		// This allows us to detect changes without causing re-renders
		const prevHeightRef = useRef(0)
		
		// DEBUG: Log ChatRow mount
		console.log("[ChatRow MOUNT]", {
			ts: message.ts,
			type: message.type,
			ask: message.ask,
			say: message.say,
		})

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
		onCancelCommand,
		mode,
		reasoningContent,
		responseStarted,
		isRequestInProgress,
	}: ChatRowContentProps) => {
		const { mcpServers, mcpMarketplaceCatalog, onRelinquishControl, vscodeTerminalExecutionMode, clineMessages } =
			useExtensionState()
		const [seeNewChangesDisabled, setSeeNewChangesDisabled] = useState(false)
		const [explainChangesDisabled, setExplainChangesDisabled] = useState(false)
		const [viewChangesHovered, setViewChangesHovered] = useState(false)
		const [explainChangesHovered, setExplainChangesHovered] = useState(false)
		const [completionContainerHovered, setCompletionContainerHovered] = useState(false)
		const [quoteButtonState, setQuoteButtonState] = useState<QuoteButtonState>({
			visible: false,
			top: 0,
			left: 0,
			selectedText: "",
		})
		const contentRef = useRef<HTMLDivElement>(null)

		// Command output expansion state (for all messages, but only used by command messages)
		const [isOutputFullyExpanded, setIsOutputFullyExpanded] = useState(false)
		const prevCommandExecutingRef = useRef<boolean>(false)
		// Completion output expansion state
		const [isCompletionOutputExpanded, setIsCompletionOutputExpanded] = useState(false)
		const hasAutoExpandedRef = useRef(false)
		const hasAutoCollapsedRef = useRef(false)
		const prevIsLastRef = useRef(isLast)

		// Auto-expand completion output when it's the last message (runs once per message)
		useEffect(() => {
			const isCompletionResult = message.ask === "completion_result" || message.say === "completion_result"

			// Auto-expand if it's last and we haven't already auto-expanded
			if (isLast && isCompletionResult && !hasAutoExpandedRef.current) {
				setIsCompletionOutputExpanded(true)
				hasAutoExpandedRef.current = true
				hasAutoCollapsedRef.current = false // Reset the auto-collapse flag when expanding
			}
		}, [isLast, message.ask, message.say])

		// Auto-collapse completion output ONCE when transitioning from last to not-last
		useEffect(() => {
			const isCompletionResult = message.ask === "completion_result" || message.say === "completion_result"
			const wasLast = prevIsLastRef.current

			// Only auto-collapse if transitioning from last to not-last, and we haven't already auto-collapsed
			if (wasLast && !isLast && isCompletionResult && !hasAutoCollapsedRef.current) {
				setIsCompletionOutputExpanded(false)
				hasAutoCollapsedRef.current = true
				hasAutoExpandedRef.current = false // Reset the auto-expand flag when collapsing
			}

			prevIsLastRef.current = isLast
		}, [isLast, message.ask, message.say])

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

		const isCommandMessage = message.ask === "command" || message.say === "command"
		// Check if command has output to determine if it's actually executing
		const commandHasOutput = message.text?.includes(COMMAND_OUTPUT_STRING) ?? false
		// A command is executing if it has output but hasn't completed yet
		const isCommandExecuting = isCommandMessage && !message.commandCompleted && commandHasOutput
		// A command is pending if it hasn't started (no output) and hasn't completed
		const isCommandPending = isCommandMessage && isLast && !message.commandCompleted && !commandHasOutput
		const isCommandCompleted = isCommandMessage && message.commandCompleted === true

		const isMcpServerResponding = isLast && lastModifiedMessage?.say === "mcp_server_request_started"

		const type = message.type === "ask" ? message.ask : message.say

		// DEBUG: Log message info to trace rendering
		console.log("[ChatRow DEBUG]", {
			ts: message.ts,
			type: message.type,
			messageType: type,
			hasText: !!message.text,
			isLast,
		})

		const handleToggle = useCallback(() => {
			onToggleExpand(message.ts)
		}, [onToggleExpand, message.ts])

		// Use the onRelinquishControl hook instead of message event
		useEffect(() => {
			return onRelinquishControl(() => {
				setSeeNewChangesDisabled(false)
				setExplainChangesDisabled(false)
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
				case "command":
					return [
						<span
							className="codicon codicon-terminal"
							style={{
								color: normalColor,
								marginBottom: "-1.5px",
							}}></span>,
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
					// API request rows no longer render the request payload/cost accordion.
					// Thinking/reasoning is handled directly in the api_req_started renderer below.
					return [null, null]
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
		}, [
			type,
			cost,
			apiRequestFailedMessage,
			isCommandExecuting,
			isCommandPending,
			apiReqCancelReason,
			isMcpServerResponding,
			message.text,
		])

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
				case "fileDeleted":
					return (
						<>
							<div style={headerStyle}>
								{toolIcon("diff-removed")}
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This file is outside of your workspace")}
								<span style={{ fontWeight: "bold" }}>Cline wants to delete this file:</span>
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
								<span style={{ color: normalColor, marginBottom: "-1.5px" }}>
									<FoldVerticalIcon size={16} />
								</span>
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
				case "webSearch":
					return (
						<>
							<div style={headerStyle}>
								<span
									className="codicon codicon-search"
									style={{ color: normalColor, marginBottom: "-1.5px" }}></span>
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This search is external")}
								<span style={{ fontWeight: "bold" }}>
									{message.type === "ask"
										? "Cline wants to search the web for:"
										: "Cline searched the web for:"}
								</span>
							</div>
							<div
								style={{
									borderRadius: 3,
									backgroundColor: CODE_BLOCK_BG_COLOR,
									overflow: "hidden",
									border: "1px solid var(--vscode-editorGroup-border)",
									padding: "9px 10px",
									userSelect: "text",
									WebkitUserSelect: "text",
									MozUserSelect: "text",
									msUserSelect: "text",
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
									}}>
									{tool.path + "\u200E"}
								</span>
							</div>
						</>
					)
				default:
					return null
			}
		}

		// Reset output expansion state when command stops (completes or is cancelled)
		useEffect(() => {
			// If command was executing and now isn't, clean up
			if (isCommandMessage && prevCommandExecutingRef.current && !isCommandExecuting) {
				setIsOutputFullyExpanded(false)
			}

			// Update ref for next render
			prevCommandExecutingRef.current = isCommandExecuting
		}, [isCommandMessage, isCommandExecuting])

		// Auto-expand when command starts executing (only if running > 500ms)
		useEffect(() => {
			if (isCommandMessage && isCommandExecuting && !isExpanded) {
				// Wait 500ms before auto-expanding to avoid animating fast commands
				const timer = setTimeout(() => {
					// Expand after 500ms
					onToggleExpand(message.ts)
				}, 500)

				return () => clearTimeout(timer)
			}
		}, [isCommandMessage, isCommandExecuting, isExpanded, onToggleExpand, message.ts])

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
			const showCancelButton =
				(isCommandExecuting || isCommandPending) &&
				typeof onCancelCommand === "function" &&
				vscodeTerminalExecutionMode === "backgroundExec"

			// Check if this is a Cline subagent command (only on VSCode platform, not JetBrains/standalone)
			const isSubagentCommand = PLATFORM_CONFIG.type === PlatformType.VSCODE && command.trim().startsWith("cline ")
			let subagentPrompt: string | undefined

			if (isSubagentCommand) {
				// Parse the cline command to extract prompt
				// Format: cline "prompt"
				const clineCommandRegex = /^cline\s+"([^"]+)"(?:\s+--no-interactive)?/
				const match = command.match(clineCommandRegex)

				if (match) {
					subagentPrompt = match[1]
				}
			}

			// Compact Cline SVG icon component
			const ClineIcon = () => (
				<svg height="16" style={{ marginBottom: "-1.5px" }} viewBox="0 0 92 96" width="16">
					<g fill="currentColor">
						<path d="M65.4492701,16.3 C76.3374701,16.3 85.1635558,25.16479 85.1635558,36.1 L85.1635558,42.7 L90.9027661,54.1647464 C91.4694141,55.2966923 91.4668177,56.6300535 90.8957658,57.7597839 L85.1635558,69.1 L85.1635558,75.7 C85.1635558,86.63554 76.3374701,95.5 65.4492701,95.5 L26.0206986,95.5 C15.1328272,95.5 6.30641291,86.63554 6.30641291,75.7 L6.30641291,69.1 L0.448507752,57.7954874 C-0.14693501,56.6464093 -0.149634367,55.2802504 0.441262896,54.1288283 L6.30641291,42.7 L6.30641291,36.1 C6.30641291,25.16479 15.1328272,16.3 26.0206986,16.3 L65.4492701,16.3 Z M62.9301895,22 L29.189529,22 C19.8723267,22 12.3191987,29.5552188 12.3191987,38.875 L12.3191987,44.5 L7.44288578,53.9634655 C6.84794449,55.1180686 6.85066096,56.4896598 7.45017099,57.6418974 L12.3191987,67 L12.3191987,72.625 C12.3191987,81.9450625 19.8723267,89.5 29.189529,89.5 L62.9301895,89.5 C72.2476729,89.5 79.8005198,81.9450625 79.8005198,72.625 L79.8005198,67 L84.5682187,57.6061395 C85.1432011,56.473244 85.1458141,55.1345713 84.5752587,53.9994398 L79.8005198,44.5 L79.8005198,38.875 C79.8005198,29.5552188 72.2476729,22 62.9301895,22 Z" />
						<ellipse cx="45.7349843" cy="11" rx="12" ry="14" />
						<ellipse cx="33.5" cy="55.5" rx="8" ry="9" />
						<ellipse cx="57.5" cy="55.5" rx="8" ry="9" />
					</g>
				</svg>
			)

			// Customize icon and title for subagent commands
			const displayIcon = isSubagentCommand ? (
				<span style={{ color: normalColor }}>
					<ClineIcon />
				</span>
			) : (
				icon
			)

			const displayTitle = isSubagentCommand ? (
				<span style={{ color: normalColor, fontWeight: "bold" }}>Cline wants to use a subagent:</span>
			) : (
				title
			)

			const commandHeader = (
				<div style={headerStyle}>
					{displayIcon}
					{displayTitle}
				</div>
			)

			return (
				<>
					{commandHeader}
					<div
						style={{
							borderRadius: 6,
							border: "1px solid var(--vscode-editorGroup-border)",
							overflow: "visible",
							backgroundColor: CHAT_ROW_EXPANDED_BG_COLOR,
							transition: "all 0.3s ease-in-out",
						}}>
						{command && (
							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									padding: "8px 10px",
									backgroundColor: CHAT_ROW_EXPANDED_BG_COLOR,
									borderBottom: "1px solid var(--vscode-editorGroup-border)",
									borderTopLeftRadius: "6px",
									borderTopRightRadius: "6px",
									borderBottomLeftRadius: 0,
									borderBottomRightRadius: 0,
								}}>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: "8px",
										flex: 1,
										minWidth: 0,
									}}>
									<div
										style={{
											width: "8px",
											height: "8px",
											borderRadius: "50%",
											backgroundColor: isCommandExecuting
												? successColor
												: isCommandPending
													? "var(--vscode-editorWarning-foreground)"
													: "var(--vscode-descriptionForeground)",
											animation: isCommandExecuting ? "pulse 2s ease-in-out infinite" : "none",
											flexShrink: 0,
										}}
									/>
									<span
										style={{
											color: isCommandExecuting
												? successColor
												: isCommandPending
													? "var(--vscode-editorWarning-foreground)"
													: "var(--vscode-descriptionForeground)",
											fontWeight: 500,
											fontSize: "13px",
											flexShrink: 0,
										}}>
										{isCommandExecuting
											? "Running"
											: isCommandPending
												? "Pending"
												: isCommandCompleted
													? "Completed"
													: "Not Executed"}
									</span>
								</div>
								<div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
									{showCancelButton && (
										<button
											onClick={(e) => {
												e.stopPropagation()
												if (vscodeTerminalExecutionMode === "backgroundExec") {
													onCancelCommand?.()
												} else {
													// For regular terminal mode, show a message
													alert(
														"This command is running in the VSCode terminal. You can manually stop it using Ctrl+C in the terminal, or switch to Background Execution mode in settings for cancellable commands.",
													)
												}
											}}
											onMouseEnter={(e) => {
												e.currentTarget.style.background = "var(--vscode-button-secondaryHoverBackground)"
											}}
											onMouseLeave={(e) => {
												e.currentTarget.style.background = "var(--vscode-button-secondaryBackground)"
											}}
											style={{
												background: "var(--vscode-button-secondaryBackground)",
												color: "var(--vscode-button-secondaryForeground)",
												border: "none",
												borderRadius: "2px",
												padding: "4px 10px",
												fontSize: "12px",
												cursor: "pointer",
												fontFamily: "inherit",
											}}>
											{vscodeTerminalExecutionMode === "backgroundExec" ? "cancel" : "stop"}
										</button>
									)}
								</div>
							</div>
						)}
						{isSubagentCommand && subagentPrompt && (
							<div style={{ padding: "10px", borderBottom: "1px solid var(--vscode-editorGroup-border)" }}>
								<div style={{ marginBottom: 0 }}>
									<strong>Prompt:</strong>{" "}
									<span className="ph-no-capture" style={{ fontFamily: "var(--vscode-editor-font-family)" }}>
										{subagentPrompt}
									</span>
								</div>
							</div>
						)}
						{/* {output.length > 0 && (
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
									<span style={{ fontSize: "0.8em" }}>
										{isSubagentCommand ? "Subagent Output" : "Command Output"}
									</span>
								</div>
							</div>
						)} */}
						{!isSubagentCommand && (
							<div style={{ opacity: 0.6, backgroundColor: CHAT_ROW_EXPANDED_BG_COLOR }}>
								<div style={{ backgroundColor: CHAT_ROW_EXPANDED_BG_COLOR }}>
									<CodeBlock forceWrap={true} source={`${"```"}shell\n${command}\n${"```"}`} />
								</div>
							</div>
						)}
						{output.length > 0 && (
							<CommandOutput
								isContainerExpanded={true}
								isOutputFullyExpanded={isOutputFullyExpanded}
								onToggle={() => setIsOutputFullyExpanded(!isOutputFullyExpanded)}
								output={output}
							/>
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
					case "api_req_started": {
						// Derive explicit state
						const hasError = !!(apiRequestFailedMessage || apiReqStreamingFailedMessage)
						const hasCost = cost != null
						const hasReasoning = !!reasoningContent
						const hasResponseStarted = !!responseStarted

						const apiReqState: ApiReqState = hasError
							? "error"
							: hasCost
								? "final"
								: hasReasoning
									? "thinking"
									: "pre"

						// While reasoning is streaming, keep the Brain ThinkingBlock exactly as-is.
						// Once response content starts (any text/tool/command), collapse into a compact
						// "🧠 Thinking" row that can be expanded to show the reasoning only.
						const showStreamingThinking = hasReasoning && !hasResponseStarted && !hasError && !hasCost
						const showCollapsedThinking = hasReasoning && !showStreamingThinking

						// Find the most recent tool activity in the conversation
						// Only show if the last tool was exploratory (read/list/search)
						// and no user/text message has occurred since
						// Memoized to avoid iterating through all messages on every render
						const currentActivity = useMemo(() => {
							// Look backwards from the end to find the most recent relevant message
							for (let i = clineMessages.length - 1; i >= 0; i--) {
								const msg = clineMessages[i]
								// Stop if we hit user feedback or Cline text - fall back to default
								if (msg.say === "user_feedback" || msg.say === "text") {
									return null
								}
								// Check for tool messages
								if (msg.say === "tool" || msg.ask === "tool") {
									try {
										const tool = JSON.parse(msg.text || "{}") as ClineSayTool
										// Exploratory tools - show activity
										if (tool.tool === "readFile" && tool.path) {
											return `Reading ${cleanPathPrefix(tool.path)}`
										}
										if (tool.tool === "listFilesTopLevel" && tool.path) {
											return `Exploring ${cleanPathPrefix(tool.path)}/`
										}
										if (tool.tool === "listFilesRecursive" && tool.path) {
											return `Exploring ${cleanPathPrefix(tool.path)}`
										}
										if (tool.tool === "searchFiles" && tool.regex) {
											return `Searching for ${tool.regex}`
										}
										if (tool.tool === "listCodeDefinitionNames" && tool.path) {
											return `Reading definitions in ${cleanPathPrefix(tool.path)}/`
										}
										// Non-exploratory tool found first - fall back to default
										return null
									} catch {
										// ignore parse errors
									}
								}
							}
							return null
						}, [clineMessages])

						return (
							<>
								{apiReqState === "pre" && (
									<div style={{ color: "var(--vscode-descriptionForeground)" }}>
										<TypewriterText
											text={currentActivity || (mode === "plan" ? "Planning..." : "Thinking...")}
										/>
									</div>
								)}

								{showStreamingThinking && (
									<ThinkingBlock
										instant={true}
										isVisible={true}
										reasoningContent={reasoningContent}
										showCursor={true}
									/>
								)}

								{showCollapsedThinking && (
									<>
										<div
											onClick={handleToggle}
											style={{
												display: "flex",
												alignItems: "center",
												gap: "8px",
												cursor: "pointer",
												userSelect: "none",
												WebkitUserSelect: "none",
												MozUserSelect: "none",
												msUserSelect: "none",
												color: "var(--vscode-descriptionForeground)",
												marginTop: apiReqState === "pre" ? 10 : 0,
												marginBottom: hasError ? 10 : 0,
											}}
											title="Click to view reasoning">
											<Brain
												size={14}
												style={{
													color: "var(--vscode-descriptionForeground)",
													opacity: 0.7,
													flexShrink: 0,
												}}
											/>
											<span style={{ fontWeight: 500 }}>Thinking</span>
											<span className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`}></span>
										</div>

										{isExpanded && reasoningContent && (
											<div
												className="ph-no-capture"
												onClick={handleToggle}
												style={{ marginTop: 8, cursor: "pointer" }}>
												<ThinkingBlock
													isVisible={true}
													reasoningContent={reasoningContent}
													showCursor={false}
													showIcon={false}
												/>
											</div>
										)}
									</>
								)}

								{apiReqState === "error" && (
									<ErrorRow
										apiReqStreamingFailedMessage={apiReqStreamingFailedMessage}
										apiRequestFailedMessage={apiRequestFailedMessage}
										errorType="error"
										message={message}
									/>
								)}
							</>
						)
					}
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
							<>
								<WithCopyButton
									onMouseUp={handleMouseUp}
									position="bottom-right"
									ref={contentRef}
									textToCopy={message.text}>
									<Markdown markdown={message.text} showCursor={isRequestInProgress} />
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
						const apiReqInfo = findApiReqInfoForCheckpoint(message.ts, clineMessages)
						const segmentCost = findNextSegmentCost(message.ts, clineMessages)
						return (
							<CheckmarkControl
								apiReqInfo={apiReqInfo}
								isCheckpointCheckedOut={message.isCheckpointCheckedOut}
								messageTs={message.ts}
								segmentCost={segmentCost}
							/>
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
					case "generate_explanation": {
						let explanationInfo: ClineSayGenerateExplanation = {
							title: "code changes",
							fromRef: "",
							toRef: "",
							status: "generating",
						}
						try {
							if (message.text) {
								explanationInfo = JSON.parse(message.text)
							}
						} catch {
							// Use defaults if parsing fails
						}
						// Check if generation was interrupted:
						// 1. If status is "generating" but this isn't the last message, it was interrupted
						// 2. If status is "generating" and lastModifiedMessage is a resume ask, task was just cancelled
						const wasCancelled =
							explanationInfo.status === "generating" &&
							(!isLast ||
								lastModifiedMessage?.ask === "resume_task" ||
								lastModifiedMessage?.ask === "resume_completed_task")
						const isGenerating = explanationInfo.status === "generating" && !wasCancelled
						const isError = explanationInfo.status === "error"
						return (
							<div
								style={{
									display: "flex",
									flexDirection: "column",
									backgroundColor: CODE_BLOCK_BG_COLOR,
									border: "1px solid var(--vscode-editorGroup-border)",
									borderRadius: 5,
									padding: "10px 12px",
									fontSize: 12,
								}}>
								<div
									style={{
										display: "flex",
										alignItems: "center",
									}}>
									{isGenerating ? (
										<span style={{ marginRight: 8 }}>
											<ProgressIndicator />
										</span>
									) : isError ? (
										<i
											className="codicon codicon-error"
											style={{ marginRight: 8, color: "var(--vscode-errorForeground)" }}
										/>
									) : wasCancelled ? (
										<i
											className="codicon codicon-circle-slash"
											style={{ marginRight: 8, color: "var(--vscode-descriptionForeground)" }}
										/>
									) : (
										<i
											className="codicon codicon-check"
											style={{ marginRight: 8, color: "var(--vscode-charts-green)" }}
										/>
									)}
									<span style={{ fontWeight: 500 }}>
										{isGenerating
											? "Generating explanation"
											: isError
												? "Failed to generate explanation"
												: wasCancelled
													? "Explanation cancelled"
													: "Generated explanation"}
									</span>
								</div>
								{isError && explanationInfo.error && (
									<div
										style={{
											opacity: 0.8,
											marginLeft: 24,
											marginTop: 6,
											color: "var(--vscode-errorForeground)",
											wordBreak: "break-word",
										}}>
										{explanationInfo.error}
									</div>
								)}
								{!isError && (explanationInfo.title || explanationInfo.fromRef) && (
									<div style={{ opacity: 0.8, marginLeft: 24, marginTop: 6 }}>
										<div>{explanationInfo.title}</div>
										{explanationInfo.fromRef && (
											<div
												style={{
													fontSize: 11,
													opacity: 0.7,
													marginTop: 4,
													marginLeft: -3,
													wordBreak: "break-all",
												}}>
												<code
													style={{
														background: "var(--vscode-textBlockQuote-background)",
														padding: "2px 6px",
														borderRadius: 3,
													}}>
													{explanationInfo.fromRef}
												</code>
												<span style={{ margin: "0 6px" }}>→</span>
												<code
													style={{
														background: "var(--vscode-textBlockQuote-background)",
														padding: "2px 6px",
														borderRadius: 3,
													}}>
													{explanationInfo.toRef || "working directory"}
												</code>
											</div>
										)}
									</div>
								)}
							</div>
						)
					}
					case "completion_result":
						const hasChanges = message.text?.endsWith(COMPLETION_RESULT_CHANGES_FLAG) ?? false
						const text = hasChanges ? message.text?.slice(0, -COMPLETION_RESULT_CHANGES_FLAG.length) : message.text
						return (
							<>
								<div
									onMouseEnter={() => setCompletionContainerHovered(true)}
									onMouseLeave={() => setCompletionContainerHovered(false)}
									style={{
										borderRadius: 6,
										border: `1px solid ${completionContainerHovered ? successColor : "var(--vscode-editorGroup-border)"}`,
										overflow: "visible",
										backgroundColor: CHAT_ROW_EXPANDED_BG_COLOR,
										transition: "border-color 0.2s ease",
									}}>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											justifyContent: "space-between",
											padding: "8px 10px",
											backgroundColor: CHAT_ROW_EXPANDED_BG_COLOR,
											borderTopLeftRadius: "6px",
											borderTopRightRadius: "6px",
											borderBottomLeftRadius: 0,
											borderBottomRightRadius: 0,
										}}>
										<div
											style={{
												display: "flex",
												alignItems: "center",
												gap: "8px",
												flex: 1,
												minWidth: 0,
											}}>
											<div
												style={{
													width: "8px",
													height: "8px",
													borderRadius: "50%",
													backgroundColor: successColor,
													flexShrink: 0,
												}}
											/>
											<span
												style={{
													color: successColor,
													fontWeight: 500,
													fontSize: "13px",
													flexShrink: 0,
												}}>
												Task Completed
											</span>
										</div>
										<CopyButton textToCopy={text || ""} />
									</div>
									<CompletionOutput
										borderColor={successColor}
										isOutputFullyExpanded={isCompletionOutputExpanded}
										onToggle={() => setIsCompletionOutputExpanded(!isCompletionOutputExpanded)}
										text={text || ""}
									/>
								</div>
								{message.partial !== true && hasChanges && (
									<div style={{ paddingTop: 17, display: "flex", flexDirection: "row", gap: 8 }}>
										<button
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
											onMouseEnter={() => setViewChangesHovered(true)}
											onMouseLeave={() => setViewChangesHovered(false)}
											style={{
												cursor: seeNewChangesDisabled ? "wait" : "pointer",
												flex: 1,
												background: CHAT_ROW_EXPANDED_BG_COLOR,
												border: `1px solid ${viewChangesHovered ? successColor : "var(--vscode-editorGroup-border)"}`,
												color: successColor,
												borderRadius: "2px",
												padding: "8px 12px",
												fontSize: "13px",
												fontFamily: "inherit",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												transition: "border-color 0.2s ease",
											}}>
											<i className="codicon codicon-new-file" style={{ marginRight: 6 }} />
											View Changes
										</button>
										{PLATFORM_CONFIG.type === PlatformType.VSCODE && (
											<button
												disabled={explainChangesDisabled}
												onClick={() => {
													setExplainChangesDisabled(true)
													TaskServiceClient.explainChanges({
														metadata: {},
														messageTs: message.ts,
													}).catch((err) => {
														console.error("Failed to explain changes:", err)
														setExplainChangesDisabled(false)
													})
												}}
												onMouseEnter={() => setExplainChangesHovered(true)}
												onMouseLeave={() => setExplainChangesHovered(false)}
												style={{
													cursor: explainChangesDisabled ? "wait" : "pointer",
													flex: 1,
													background: CHAT_ROW_EXPANDED_BG_COLOR,
													border: `1px solid ${explainChangesHovered ? successColor : "var(--vscode-editorGroup-border)"}`,
													color: successColor,
													borderRadius: "2px",
													padding: "8px 12px",
													fontSize: "13px",
													fontFamily: "inherit",
													display: "flex",
													alignItems: "center",
													justifyContent: "center",
													transition: "border-color 0.2s ease",
												}}>
												<i className="codicon codicon-comment-discussion" style={{ marginRight: 6 }} />
												{explainChangesDisabled ? "Explaining..." : "Explain Changes"}
											</button>
										)}
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
					case "error_retry":
						try {
							const retryInfo = JSON.parse(message.text || "{}")
							const { attempt, maxAttempts, delaySeconds, failed } = retryInfo
							const isFailed = failed === true

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
											className={isFailed ? "codicon codicon-warning" : "codicon codicon-sync"}
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
											{isFailed ? "Auto-Retry Failed" : "Auto-Retry in Progress"}
										</span>
									</div>
									<div style={{ color: "var(--vscode-foreground)", opacity: 0.8 }}>
										{isFailed ? (
											<>
												Auto-retry failed after <strong>{maxAttempts}</strong> attempts. Manual
												intervention required.
											</>
										) : (
											<>
												Attempt <strong>{attempt}</strong> of <strong>{maxAttempts}</strong> - Retrying in{" "}
												{delaySeconds} seconds...
											</>
										)}
									</div>
								</div>
							)
						} catch (_e) {
							// Fallback if JSON parsing fails
							return (
								<div style={{ color: "var(--vscode-foreground)" }}>
									<Markdown markdown={message.text} />
								</div>
							)
						}
					case "hook":
						return <HookMessage CommandOutput={CommandOutput} message={message} />
					case "hook_output":
						// hook_output messages are combined with hook messages, so we don't render them separately
						return null
					case "shell_integration_warning_with_suggestion":
						const isBackgroundModeEnabled = vscodeTerminalExecutionMode === "backgroundExec"
						return (
							<div
								style={{
									padding: 8,
									backgroundColor: "rgba(0, 122, 204, 0.1)",
									borderRadius: 3,
									border: "1px solid rgba(0, 122, 204, 0.3)",
								}}>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										marginBottom: 4,
									}}>
									<i
										className="codicon codicon-lightbulb"
										style={{
											marginRight: 6,
											fontSize: 14,
											color: "var(--vscode-textLink-foreground)",
										}}></i>
									<span
										style={{
											fontWeight: 500,
											color: "var(--vscode-foreground)",
										}}>
										Shell integration issues
									</span>
								</div>
								<div style={{ color: "var(--vscode-foreground)", opacity: 0.9, marginBottom: 8 }}>
									Since you're experiencing repeated shell integration issues, we recommend switching to
									Background Terminal mode for better reliability.
								</div>
								<button
									disabled={isBackgroundModeEnabled}
									onClick={async () => {
										try {
											// Enable background terminal execution mode
											await UiServiceClient.setTerminalExecutionMode(BooleanRequest.create({ value: true }))
										} catch (error) {
											console.error("Failed to enable background terminal:", error)
										}
									}}
									onMouseEnter={(e) => {
										if (!isBackgroundModeEnabled) {
											e.currentTarget.style.background = "var(--vscode-button-hoverBackground)"
										}
									}}
									onMouseLeave={(e) => {
										if (!isBackgroundModeEnabled) {
											e.currentTarget.style.background = isBackgroundModeEnabled
												? "var(--vscode-charts-green)"
												: "var(--vscode-button-background)"
										}
									}}
									style={{
										background: isBackgroundModeEnabled
											? "var(--vscode-charts-green)"
											: "var(--vscode-button-background)",
										color: "var(--vscode-button-foreground)",
										border: "none",
										borderRadius: 2,
										padding: "6px 12px",
										fontSize: 12,
										cursor: isBackgroundModeEnabled ? "default" : "pointer",
										fontFamily: "inherit",
										display: "flex",
										alignItems: "center",
										gap: 6,
										opacity: isBackgroundModeEnabled ? 0.8 : 1,
									}}>
									<i className="codicon codicon-settings-gear"></i>
									{isBackgroundModeEnabled
										? "Background Terminal Enabled"
										: "Enable Background Terminal (Recommended)"}
								</button>
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
					case "completion_result":
						if (message.text) {
							const hasChanges = message.text.endsWith(COMPLETION_RESULT_CHANGES_FLAG) ?? false
							const text = hasChanges ? message.text.slice(0, -COMPLETION_RESULT_CHANGES_FLAG.length) : message.text
							return (
								<div>
									<div
										style={{
											borderRadius: 6,
											border: `1px solid ${successColor}`,
											overflow: "visible",
											backgroundColor: CHAT_ROW_EXPANDED_BG_COLOR,
											transition: "all 0.3s ease-in-out",
										}}>
										<div
											style={{
												display: "flex",
												alignItems: "center",
												justifyContent: "space-between",
												padding: "8px 10px",
												backgroundColor: CHAT_ROW_EXPANDED_BG_COLOR,
												borderTopLeftRadius: "6px",
												borderTopRightRadius: "6px",
												borderBottomLeftRadius: 0,
												borderBottomRightRadius: 0,
											}}>
											<div
												style={{
													display: "flex",
													alignItems: "center",
													gap: "8px",
													flex: 1,
													minWidth: 0,
												}}>
												<div
													style={{
														width: "8px",
														height: "8px",
														borderRadius: "50%",
														backgroundColor: successColor,
														flexShrink: 0,
													}}
												/>
												<span
													style={{
														color: successColor,
														fontWeight: 500,
														fontSize: "13px",
														flexShrink: 0,
													}}>
													Task Completed
												</span>
											</div>
											<div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
												<CopyButton textToCopy={text || ""} />
												<TaskFeedbackButtons
													isFromHistory={
														!isLast ||
														lastModifiedMessage?.ask === "resume_completed_task" ||
														lastModifiedMessage?.ask === "resume_task"
													}
													messageTs={message.ts}
													style={{
														flexShrink: 0,
													}}
												/>
											</div>
										</div>
										<CompletionOutput
											borderColor={successColor}
											isOutputFullyExpanded={isCompletionOutputExpanded}
											onToggle={() => setIsCompletionOutputExpanded(!isCompletionOutputExpanded)}
											text={text || ""}
										/>
									</div>
									{message.partial !== true && hasChanges && (
										<div style={{ marginTop: 15, display: "flex", flexDirection: "row", gap: 8 }}>
											<button
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
												onMouseEnter={() => setViewChangesHovered(true)}
												onMouseLeave={() => setViewChangesHovered(false)}
												style={{
													cursor: seeNewChangesDisabled ? "wait" : "pointer",
													flex: 1,
													background: CHAT_ROW_EXPANDED_BG_COLOR,
													border: `1px solid ${viewChangesHovered ? successColor : "var(--vscode-editorGroup-border)"}`,
													color: successColor,
													borderRadius: "2px",
													padding: "8px 12px",
													fontSize: "13px",
													fontFamily: "inherit",
													display: "flex",
													alignItems: "center",
													justifyContent: "center",
													transition: "border-color 0.2s ease",
												}}>
												<i className="codicon codicon-new-file" style={{ marginRight: 6 }} />
												View Changes
											</button>
											{PLATFORM_CONFIG.type === PlatformType.VSCODE && (
												<button
													disabled={explainChangesDisabled}
													onClick={() => {
														setExplainChangesDisabled(true)
														TaskServiceClient.explainChanges({
															metadata: {},
															messageTs: message.ts,
														}).catch((err) => {
															console.error("Failed to explain changes:", err)
															setExplainChangesDisabled(false)
														})
													}}
													onMouseEnter={() => setExplainChangesHovered(true)}
													onMouseLeave={() => setExplainChangesHovered(false)}
													style={{
														cursor: explainChangesDisabled ? "wait" : "pointer",
														flex: 1,
														background: CHAT_ROW_EXPANDED_BG_COLOR,
														border: `1px solid ${explainChangesHovered ? successColor : "var(--vscode-editorGroup-border)"}`,
														color: successColor,
														borderRadius: "2px",
														padding: "8px 12px",
														fontSize: "13px",
														fontFamily: "inherit",
														display: "flex",
														alignItems: "center",
														justifyContent: "center",
														transition: "border-color 0.2s ease",
													}}>
													<i
														className="codicon codicon-comment-discussion"
														style={{ marginRight: 6 }}
													/>
													{explainChangesDisabled ? "Explaining..." : "Explain Changes"}
												</button>
											)}
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
							<div>
								{title && (
									<div style={headerStyle}>
										{icon}
										{title}
									</div>
								)}
								<WithCopyButton
									className="pt-2.5"
									onMouseUp={handleMouseUp}
									position="bottom-right"
									ref={contentRef}
									textToCopy={question}>
									<Markdown markdown={question} />
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
								<OptionsButtons
									inputValue={inputValue}
									isActive={
										(isLast && lastModifiedMessage?.ask === "followup") ||
										(!selected && options && options.length > 0)
									}
									options={options}
									selected={selected}
								/>
							</div>
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
							<>
								<WithCopyButton
									onMouseUp={handleMouseUp}
									position="bottom-right"
									ref={contentRef}
									textToCopy={response}>
									<Markdown markdown={response} />
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
								<OptionsButtons
									inputValue={inputValue}
									isActive={
										(isLast && lastModifiedMessage?.ask === "plan_mode_respond") ||
										(!selected && options && options.length > 0)
									}
									options={options}
									selected={selected}
								/>
							</>
						)
					}
					default:
						return null
				}
		}
	},
)

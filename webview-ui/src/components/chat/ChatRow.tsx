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
import deepEqual from "fast-deep-equal"
import {
	CircleXIcon,
	FilePlus2Icon,
	FoldVerticalIcon,
	LoaderCircleIcon,
	MessageSquareTextIcon,
	PencilIcon,
	SquareMinusIcon,
	TerminalIcon,
} from "lucide-react"
import { MouseEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSize } from "react-use"
import { ClineCompactIcon } from "@/assets/ClineCompactIcon"
import ClineLogoWhite from "@/assets/ClineLogoWhite"
import { OptionsButtons } from "@/components/chat/OptionsButtons"
import TaskFeedbackButtons from "@/components/chat/TaskFeedbackButtons"
import { CheckmarkControl } from "@/components/common/CheckmarkControl"
import { CopyButton, WithCopyButton } from "@/components/common/CopyButton"
import McpResponseDisplay from "@/components/mcp/chat-display/McpResponseDisplay"
import McpResourceRow from "@/components/mcp/configuration/tabs/installed/server-row/McpResourceRow"
import McpToolRow from "@/components/mcp/configuration/tabs/installed/server-row/McpToolRow"
import { Button } from "@/components/ui/button"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { FileServiceClient, TaskServiceClient, UiServiceClient } from "@/services/grpc-client"
import { findMatchingResourceOrTemplate, getMcpServerDisplayName } from "@/utils/mcp"
import CodeAccordian, { cleanPathPrefix } from "../common/CodeAccordian"
import CodeBlock from "../common/CodeBlock"
import { CommandOutputContent } from "./CommandOutputRow"
import { CompletionOutputRow } from "./CompletionOutputRow"
import { DiffEditRow } from "./DiffEditRow"
import ErrorRow from "./ErrorRow"
import HookMessage from "./HookMessage"
import { MarkdownRow } from "./MarkdownRow"
import NewTaskPreview from "./NewTaskPreview"
import PlanCompletionOutputRow from "./PlanCompletionOutputRow"
import QuoteButton from "./QuoteButton"
import ReportBugPreview from "./ReportBugPreview"
import SearchResultsDisplay from "./SearchResultsDisplay"
import { ThinkingRow } from "./ThinkingRow"
import { TypewriterText } from "./TypewriterText"
import UserMessage from "./UserMessage"

// State type for api_req_started rendering
type ApiReqState = "pre" | "thinking" | "error" | "final"

const HEADER_CLASSNAMES = "flex items-center gap-2.5 mb-3"

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
	<div className="w-4 h-4 flex items-center justify-center">
		<LoaderCircleIcon className="animate-spin" />
	</div>
)

const ChatRow = memo(
	(props: ChatRowProps) => {
		const { isLast, onHeightChange, message } = props
		// Store the previous height to compare with the current height
		// This allows us to detect changes without causing re-renders
		const prevHeightRef = useRef(0)

		const [chatrow, { height }] = useSize(
			<div className="relative py-2.5 px-4">
				<ChatRowContent {...props} />
			</div>,
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
		const {
			backgroundEditEnabled,
			mcpServers,
			mcpMarketplaceCatalog,
			onRelinquishControl,
			vscodeTerminalExecutionMode,
			clineMessages,
		} = useExtensionState()
		const [seeNewChangesDisabled, setSeeNewChangesDisabled] = useState(false)
		const [explainChangesDisabled, setExplainChangesDisabled] = useState(false)
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

		const [cost, apiReqCancelReason, apiReqStreamingFailedMessage] = useMemo(() => {
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
						<span className="codicon codicon-error text-error mb-[-1.5px]" />,
						<span className="text-error font-bold">Error</span>,
					]
				case "mistake_limit_reached":
					return [
						<CircleXIcon className="mb-[-1.5px] text-error size-3 stroke-1" />,
						<span className="text-error font-bold">Cline is having trouble...</span>,
					]
				case "command":
					return [
						<TerminalIcon className="mb-[-1.5px] text-foreground size-3 stroke-1" />,
						<span className="font-bold text-foreground">Cline wants to execute this command:</span>,
					]
				case "use_mcp_server":
					const mcpServerUse = JSON.parse(message.text || "{}") as ClineAskUseMcpServer
					return [
						isMcpServerResponding ? (
							<ProgressIndicator />
						) : (
							<span className="codicon codicon-server text-foreground mb-[-1.5px]" />
						),
						<span className="ph-no-capture font-bold text-foreground break-words">
							Cline wants to {mcpServerUse.type === "use_mcp_tool" ? "use a tool" : "access a resource"} on the{" "}
							<code className="break-all">
								{getMcpServerDisplayName(mcpServerUse.serverName, mcpMarketplaceCatalog)}
							</code>{" "}
							MCP server:
						</span>,
					]
				case "completion_result":
					return [
						<span className="codicon codicon-check text-success mb-[-1.5px]" />,
						<span className="text-success font-bold">Task Completed</span>,
					]
				case "api_req_started":
					// API request rows no longer render the request payload/cost accordion.
					// Thinking/reasoning is handled directly in the api_req_started renderer below.
					return [null, null]
				case "followup":
					return [
						<span className="codicon codicon-question text-foreground mb-[-1.5px]" />,
						<span className="font-bold text-foreground">Cline has a question:</span>,
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
					const content = tool?.content || ""
					const isApplyingPatch = content?.startsWith("%%bash") && !content.endsWith("*** End Patch\nEOF")
					const editToolTitle = isApplyingPatch
						? "Cline is creating patches to edit this file:"
						: "Cline wants to edit this file:"
					return (
						<>
							<div className={HEADER_CLASSNAMES}>
								<PencilIcon className="mb-[-1.5px] size-3 stroke-1" />
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This file is outside of your workspace")}
								<span style={{ fontWeight: "bold" }}>{editToolTitle}</span>
							</div>
							{backgroundEditEnabled && tool.path && tool.content ? (
								<DiffEditRow isLoading={message.partial} patch={tool.content} path={tool.path} />
							) : (
								<CodeAccordian
									// isLoading={message.partial}
									code={tool.content}
									isExpanded={isExpanded}
									onToggleExpand={handleToggle}
									path={tool.path!}
								/>
							)}
						</>
					)
				case "fileDeleted":
					return (
						<>
							<div className={HEADER_CLASSNAMES}>
								<SquareMinusIcon className="mb-[-1.5px] size-3 stroke-1" />
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
							<div className={HEADER_CLASSNAMES}>
								<FilePlus2Icon className="size-3 stroke-1" />
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This file is outside of your workspace")}
								<span className="font-bold">Cline wants to create a new file:</span>
							</div>
							{backgroundEditEnabled && tool.path && tool.content ? (
								<DiffEditRow patch={tool.content} path={tool.path} />
							) : (
								<CodeAccordian
									code={tool.content!}
									isExpanded={isExpanded}
									isLoading={message.partial}
									onToggleExpand={handleToggle}
									path={tool.path!}
								/>
							)}
						</>
					)
				case "readFile":
					const isImage = isImageFile(tool.path || "")
					return (
						<>
							<div className={HEADER_CLASSNAMES}>
								{toolIcon(isImage ? "file-media" : "file-code")}
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This file is outside of your workspace")}
								<span style={{ fontWeight: "bold" }}>
									{/* {message.type === "ask" ? "" : "Cline read this file:"} */}
									Cline wants to read this file:
								</span>
							</div>
							<div
								className="bg-code"
								style={{
									borderRadius: 3,
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
							<div className={HEADER_CLASSNAMES}>
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
							<div className={HEADER_CLASSNAMES}>
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
							<div className={HEADER_CLASSNAMES}>
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
							<div className={HEADER_CLASSNAMES}>
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
							<div className={HEADER_CLASSNAMES}>
								<span className="text-foreground mb-[-1.5px]">
									<FoldVerticalIcon size={16} />
								</span>
								<span className="font-bold">Cline is condensing the conversation:</span>
							</div>
							<div
								className="bg-code overflow-hidden border border-editor-group-border"
								style={{
									borderRadius: 3,
								}}>
								<div
									aria-label={isExpanded ? "Collapse summary" : "Expand summary"}
									onClick={handleToggle}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault()
											e.stopPropagation()
											handleToggle()
										}
									}}
									style={{
										color: "var(--vscode-descriptionForeground)",
										padding: "9px 10px",
										cursor: "pointer",
										userSelect: "none",
										WebkitUserSelect: "none",
										MozUserSelect: "none",
										msUserSelect: "none",
									}}
									tabIndex={0}>
									{isExpanded ? (
										<div>
											<div className="flex items-center mb-2">
												<span className="font-bold mr-1">Summary:</span>
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
										<div className="flex items-center">
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
												}}
											/>
										</div>
									)}
								</div>
							</div>
						</>
					)
				case "webFetch":
					return (
						<>
							<div className={HEADER_CLASSNAMES}>
								<span className="codicon codicon-link color-foreground mb-[-1.5px]" />
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This URL is external")}
								<span style={{ fontWeight: "bold" }}>
									{message.type === "ask"
										? "Cline wants to fetch content from this URL:"
										: "Cline fetched content from this URL:"}
								</span>
							</div>
							<div
								className="bg-code"
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
							<div className={HEADER_CLASSNAMES}>
								<span className="codicon codicon-search text-foreground mb-[-1.5px]" />
								{tool.operationIsLocatedInWorkspace === false &&
									toolIcon("sign-out", "yellow", -90, "This search is external")}
								<span className="text-foreground font-bold">
									{message.type === "ask"
										? "Cline wants to search the web for:"
										: "Cline searched the web for:"}
								</span>
							</div>
							<div
								className="bg-code"
								style={{
									borderRadius: 3,
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

			// Customize icon and title for subagent commands
			const displayIcon = isSubagentCommand ? (
				<span className="text-foreground mb-[-1.5px]">
					<ClineCompactIcon />
				</span>
			) : (
				icon
			)

			const displayTitle = isSubagentCommand ? (
				<span className="text-foreground font-bold">Cline wants to use a subagent:</span>
			) : (
				title
			)

			const commandHeader = (
				<div className={HEADER_CLASSNAMES}>
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
							backgroundColor: "var(--vscode-editor-background)",
							transition: "all 0.3s ease-in-out",
						}}>
						{command && (
							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									padding: "8px 10px",
									backgroundColor: "var(--vscode-editor-background)",
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
												? "var(--vscode-charts-green)"
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
												? "var(--vscode-charts-green)"
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
													: "Skipped"}
									</span>
								</div>
								<div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
									{showCancelButton && (
										<Button
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
											variant="secondary">
											{vscodeTerminalExecutionMode === "backgroundExec" ? "cancel" : "stop"}
										</Button>
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
						{!isSubagentCommand && (
							<div style={{ opacity: 0.6, backgroundColor: "var(--vscode-editor-background)" }}>
								<div style={{ backgroundColor: "var(--vscode-editor-background)" }}>
									<CodeBlock forceWrap={true} source={`${"```"}shell\n${command}\n${"```"}`} />
								</div>
							</div>
						)}
						{output.length > 0 && (
							<CommandOutputContent
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
					<div className={HEADER_CLASSNAMES}>
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

						// Find all exploratory tool activities from the PREVIOUS completed API request.
						// This shows what Cline just ingested while waiting for the next response.
						// Includes action verbiage and icons for each tool type.
						// Memoized to avoid iterating through all messages on every render.
						const currentActivities = useMemo(() => {
							const activities: { icon: string; text: string }[] = []

							// Helper to format search regex for display - show all terms separated by |
							const formatSearchRegex = (regex: string, path: string, filePattern?: string): string => {
								const terms = regex
									.split("|")
									.map((t) => t.trim().replace(/\\b/g, "").replace(/\\s\?/g, " "))
									.filter(Boolean)
								let result = `"${terms.join(" | ")}" in ${cleanPathPrefix(path)}/`
								if (filePattern && filePattern !== "*") {
									result += ` (${filePattern})`
								}
								return result
							}

							// Find the most recent api_req_started (the current one being rendered)
							// Then find the PREVIOUS api_req_started that has a cost (completed)
							// Collect all low-stakes tools between those two

							let currentApiReqIndex = -1
							let prevCompletedApiReqIndex = -1

							// Find the current api_req_started (most recent)
							for (let i = clineMessages.length - 1; i >= 0; i--) {
								if (clineMessages[i].say === "api_req_started") {
									currentApiReqIndex = i
									break
								}
							}

							if (currentApiReqIndex === -1) {
								return activities
							}

							// Find the previous api_req_started that is completed (has cost)
							for (let i = currentApiReqIndex - 1; i >= 0; i--) {
								const msg = clineMessages[i]
								if (msg.say === "api_req_started" && msg.text) {
									try {
										const info = JSON.parse(msg.text)
										if (info.cost != null) {
											prevCompletedApiReqIndex = i
											break
										}
									} catch {
										// ignore parse errors
									}
								}
							}

							if (prevCompletedApiReqIndex === -1) {
								return activities
							}

							// Collect all low-stakes tools between prevCompletedApiReq and currentApiReq
							for (let i = prevCompletedApiReqIndex + 1; i < currentApiReqIndex; i++) {
								const msg = clineMessages[i]
								if (msg.say === "tool" || msg.ask === "tool") {
									try {
										const tool = JSON.parse(msg.text || "{}") as ClineSayTool
										// Exploratory tools - collect activity with icon and action verbiage
										if (tool.tool === "readFile" && tool.path) {
											activities.push({
												icon: "file-code",
												text: `Reading ${cleanPathPrefix(tool.path)}...`,
											})
										} else if (tool.tool === "listFilesTopLevel" && tool.path) {
											activities.push({
												icon: "folder-opened",
												text: `Exploring ${cleanPathPrefix(tool.path)}/...`,
											})
										} else if (tool.tool === "listFilesRecursive" && tool.path) {
											activities.push({
												icon: "folder-opened",
												text: `Exploring ${cleanPathPrefix(tool.path)}/...`,
											})
										} else if (tool.tool === "searchFiles" && tool.regex && tool.path) {
											activities.push({
												icon: "search",
												text: `Searching ${formatSearchRegex(tool.regex, tool.path, tool.filePattern)}...`,
											})
										} else if (tool.tool === "listCodeDefinitionNames" && tool.path) {
											activities.push({
												icon: "symbol-class",
												text: `Analyzing ${cleanPathPrefix(tool.path)}/...`,
											})
										}
										// Non-exploratory tools are ignored (they have their own UI)
									} catch {
										// ignore parse errors
									}
								}
							}

							return activities
						}, [clineMessages])

						return (
							<>
								{apiReqState === "pre" && (
									<div className="flex items-start gap-2 text-description">
										<div className="mt-1 flex-shrink-0">
											<ClineLogoWhite className="size-3.5" style={{ transform: "scale(1.1)" }} />
										</div>
										<div
											style={{
												paddingLeft: "8px",
												borderLeft: "1px solid rgba(255, 255, 255, 0.1)",
												flex: 1,
											}}>
											{currentActivities.length > 0 ? (
												<div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
													{currentActivities.map((activity, i) => (
														<div className="flex items-start gap-2" key={i}>
															<span
																className={`codicon codicon-${activity.icon}`}
																style={{ fontSize: "12px", opacity: 0.7, flexShrink: 0 }}
															/>
															<span style={{ flex: 1 }}>
																<TypewriterText speed={15} text={activity.text} />
															</span>
														</div>
													))}
												</div>
											) : (
												<TypewriterText text={mode === "plan" ? "Planning..." : "Thinking..."} />
											)}
										</div>
									</div>
								)}

								{showStreamingThinking && (
									<ThinkingRow
										instant={true}
										isVisible={true}
										reasoningContent={reasoningContent}
										showCursor={true}
									/>
								)}

								{showCollapsedThinking && (
									<>
										<div
											className={cn(
												"flex items-center gap-2 select-none mt-0 mb-0 text-description cursor-pointer",
												{
													"mt-2": apiReqState === "pre",
													"mb-2": hasError,
												},
											)}
											onClick={handleToggle}
											title="Click to view reasoning">
											<span className="font-semibold">Thinking</span>
											<span className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`}></span>
										</div>

										{isExpanded && reasoningContent && (
											<div className="ph-no-capture mt-2 cursor-pointer" onClick={handleToggle}>
												<ThinkingRow
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
					case "text": {
						return (
							<WithCopyButton
								onMouseUp={handleMouseUp}
								position="bottom-right"
								ref={contentRef}
								textToCopy={message.text}>
								{isRequestInProgress ? (
									<div className="flex items-center gap-2">
										<div className="mt-[1px] shrink-0">
											<ClineLogoWhite
												className="size-3.5 animate-icon-pulse"
												style={{
													transform: "scale(1.1)",
												}}
											/>
										</div>
										<div className="flex-1 min-w-0 pl-2 border-l border-white/10">
											<MarkdownRow markdown={message.text} showCursor={true} />
										</div>
									</div>
								) : (
									<MarkdownRow markdown={message.text} showCursor={false} />
								)}
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
					case "reasoning":
						if (!message.text) {
							return null
						}
						return (
							<>
								<div
									className={cn(
										"flex items-center gap-2 select-none mt-0 mb-0 text-description cursor-pointer",
									)}
									onClick={handleToggle}
									title="Click to view reasoning">
									<span className="font-semibold">Thinking</span>
									<span className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`} />
								</div>

								{isExpanded && message.text && (
									<div className="ph-no-capture mt-2 cursor-pointer" onClick={handleToggle}>
										<ThinkingRow
											isVisible={true}
											reasoningContent={message.text}
											showCursor={false}
											showIcon={false}
										/>
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
								className="bg-code flex flex-col border border-editor-group-border"
								style={{
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
										<i className="codicon codicon-error mr-2 text-error" />
									) : wasCancelled ? (
										<i className="codicon codicon-circle-slash mr-2 text-description" />
									) : (
										<i className="codicon codicon-check mr-2 text-success" />
									)}
									<span className="font-semibold">
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
									<div className="opacity-80 ml-6 mt-1.5">
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
								<div className="rounded-sm border border-editor-group-border overflow-visible bg-code transition-border duration-300 ease-in-out hover:border-success">
									<div className="flex items-center justify-between px-3 py-2 bg-code rounded-0 rounded-tl-sm rounded-tr-sm">
										<div className="flex items-center gap-2 flex-1 min-w-0 mx-2">
											<div className="w-2 h-2 rounded-full bg-success shrink-0" />
											<span className="text-success font-semibold text-sm shrink-0">Task Completed</span>
										</div>
										<CopyButton className="px-0" textToCopy={text || ""} />
									</div>
									<CompletionOutputRow
										isOutputFullyExpanded={isCompletionOutputExpanded}
										onToggle={() => setIsCompletionOutputExpanded(!isCompletionOutputExpanded)}
										text={text || ""}
									/>
								</div>
								{message.partial !== true && hasChanges && (
									<div className="mt-4 flex flex-row gap-2">
										<Button
											className={cn(
												"flex-1 bg-code cursor-pointer border border-editor-group-border text-success rounded-xs px-3 py-2 flex items-center justify-center transition-border duration-200 ease-in-out hover:border-success",
												{
													"cursor-wait": seeNewChangesDisabled,
												},
											)}
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
											variant="success">
											<FilePlus2Icon className="mb-[-1.5px] size-3 stroke-1 mr-1.5" />
											View Changes
										</Button>
										{PLATFORM_CONFIG.type === PlatformType.VSCODE && (
											<Button
												className={cn(
													"flex-1 bg-code cursor-pointer border border-editor-group-border text-success rounded-xs px-3 py-2 flex items-center justify-center transition-border duration-200 ease-in-out hover:border-success",
													{
														"cursor-wait": explainChangesDisabled,
													},
												)}
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
												variant="success">
												<i className="codicon codicon-comment-discussion mr-1.5" />
												{explainChangesDisabled ? "Explaining..." : "Explain Changes"}
											</Button>
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
									<MarkdownRow markdown={message.text} />
								</div>
							)
						}
					case "hook":
						return <HookMessage CommandOutput={CommandOutputContent} message={message} />
					case "hook_output":
						// hook_output messages are combined with hook messages, so we don't render them separately
						return null
					case "shell_integration_warning_with_suggestion":
						const isBackgroundModeEnabled = vscodeTerminalExecutionMode === "backgroundExec"
						return (
							<div
								style={{
									padding: 8,
									backgroundColor: "color-mix(in srgb, var(--vscode-textLink-foreground) 10%, transparent)",
									borderRadius: 3,
									border: "1px solid color-mix(in srgb, var(--vscode-textLink-foreground) 30%, transparent)",
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
									<div className={HEADER_CLASSNAMES}>
										{icon}
										{title}
									</div>
								)}
								<div style={{ paddingTop: 10 }}>
									<MarkdownRow markdown={message.text} />
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
									<div className="rounded-sm border border-editor-group-border hover:border-success overflow-visible bg-code transition-all duration-300 ease-in-out">
										<div className="flex items-center justify-between py-2 rounded-t-sm bg-code">
											<div className="flex items-center gap-2 flex-1 min-w-0 px-2">
												<div className="w-2 h-2 rounded-full bg-success flex-shrink-0" />
												<span className="text-success font-bold text-sm flex-shrink-0">
													Task Completed
												</span>
											</div>
											<div className="flex items-center gap-2 flex-shrink-0">
												<CopyButton textToCopy={text || ""} />
												<TaskFeedbackButtons
													isFromHistory={
														!isLast ||
														lastModifiedMessage?.ask === "resume_completed_task" ||
														lastModifiedMessage?.ask === "resume_task"
													}
													messageTs={message.ts}
												/>
											</div>
										</div>
										<CompletionOutputRow
											isOutputFullyExpanded={isCompletionOutputExpanded}
											onToggle={() => setIsCompletionOutputExpanded(!isCompletionOutputExpanded)}
											text={text || ""}
										/>
									</div>
									{message.partial !== true && hasChanges && (
										<div className="mt-4 flex flex-row gap-2">
											<Button
												className={cn(
													"flex-1 bg-code border border-editor-group-border text-success rounded-xs px-3 py-2 flex items-center justify-center transition-border duration-200 ease-in-out hover:border-success",
													{
														"cursor-wait": seeNewChangesDisabled,
													},
												)}
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
												variant="success">
												<FilePlus2Icon className="mb-[-1.5px] size-3 stroke-1 mr-1.5" />
												View Changes
											</Button>
											{PLATFORM_CONFIG.type === PlatformType.VSCODE && (
												<Button
													className={cn(
														"flex-1 bg-code border border-editor-group-border text-success rounded-xs px-3 py-2 flex items-center justify-center transition-border duration-200 ease-in-out hover:border-success",
														{
															"cursor-wait": explainChangesDisabled,
														},
													)}
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
													variant="success">
													<MessageSquareTextIcon className="mb-[-1.5px] size-3 stroke-1 mr-1.5" />
													{explainChangesDisabled ? "Explaining..." : "Explain Changes"}
												</Button>
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
									<div className={HEADER_CLASSNAMES}>
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
									<MarkdownRow markdown={question} />
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
								<div className={HEADER_CLASSNAMES}>
									<FilePlus2Icon className="mb-[-1.5px] size-3 stroke-1 " />
									<span className="text-foreground font-bold">Cline wants to start a new task:</span>
								</div>
								<NewTaskPreview context={message.text || ""} />
							</>
						)
					case "condense":
						return (
							<>
								<div className={HEADER_CLASSNAMES}>
									<FilePlus2Icon className="mb-[-1.5px] size-3 stroke-1 " />
									<span className="text-foreground font-bold">Cline wants to condense your conversation:</span>
								</div>
								<NewTaskPreview context={message.text || ""} />
							</>
						)
					case "report_bug":
						return (
							<>
								<div className={HEADER_CLASSNAMES}>
									<FilePlus2Icon className="mb-[-1.5px] size-3 stroke-1 " />
									<span className="text-foreground font-bold">Cline wants to create a Github issue:</span>
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
							<div>
								<PlanCompletionOutputRow text={response || message.text || ""} />
								<OptionsButtons
									inputValue={inputValue}
									isActive={
										(isLast && lastModifiedMessage?.ask === "plan_mode_respond") ||
										(!selected && options && options.length > 0)
									}
									options={options}
									selected={selected}
								/>
							</div>
						)
					}
					default:
						return null
				}
		}
	},
)

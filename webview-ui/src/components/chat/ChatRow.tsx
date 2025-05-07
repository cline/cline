import React, { memo, useEffect, useMemo, useRef, useState } from "react"
import { useSize } from "react-use"
import { useTranslation, Trans } from "react-i18next"
import deepEqual from "fast-deep-equal"
import { VSCodeBadge, VSCodeButton } from "@vscode/webview-ui-toolkit/react"

import { ClineApiReqInfo, ClineAskUseMcpServer, ClineMessage, ClineSayTool } from "@roo/shared/ExtensionMessage"
import { COMMAND_OUTPUT_STRING } from "@roo/shared/combineCommandSequences"
import { safeJsonParse } from "@roo/shared/safeJsonParse"

import { cn } from "@/lib/utils"
import { useCopyToClipboard } from "@src/utils/clipboard"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { findMatchingResourceOrTemplate } from "@src/utils/mcp"
import { vscode } from "@src/utils/vscode"
import { Button } from "@src/components/ui"

import CodeAccordian, { removeLeadingNonAlphanumeric } from "../common/CodeAccordian"
import CodeBlock from "../common/CodeBlock"
import MarkdownBlock from "../common/MarkdownBlock"
import { ReasoningBlock } from "./ReasoningBlock"
import Thumbnails from "../common/Thumbnails"
import McpResourceRow from "../mcp/McpResourceRow"
import McpToolRow from "../mcp/McpToolRow"

import { Mention } from "./Mention"
import { CheckpointSaved } from "./checkpoints/CheckpointSaved"
import { FollowUpSuggest } from "./FollowUpSuggest"
import { ProgressIndicator } from "./ProgressIndicator"
import { Markdown } from "./Markdown"
import { CommandExecution } from "./CommandExecution"
import { CommandExecutionError } from "./CommandExecutionError"

interface ChatRowProps {
	message: ClineMessage
	lastModifiedMessage?: ClineMessage
	isExpanded: boolean
	isLast: boolean
	isStreaming: boolean
	onToggleExpand: () => void
	onHeightChange: (isTaller: boolean) => void
	onSuggestionClick?: (answer: string, event?: React.MouseEvent) => void
}

interface ChatRowContentProps extends Omit<ChatRowProps, "onHeightChange"> {}

const ChatRow = memo(
	(props: ChatRowProps) => {
		const { isLast, onHeightChange, message } = props
		// Store the previous height to compare with the current height
		// This allows us to detect changes without causing re-renders
		const prevHeightRef = useRef(0)

		const [chatrow, { height }] = useSize(
			<div className="px-[15px] py-[10px] pr-[6px]">
				<ChatRowContent {...props} />
			</div>,
		)

		useEffect(() => {
			// used for partials, command output, etc.
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

		// we cannot return null as virtuoso does not support it, so we use a separate visibleMessages array to filter out messages that should not be rendered
		return chatrow
	},
	// memo does shallow comparison of props, so we need to do deep comparison of arrays/objects whose properties might change
	deepEqual,
)

export default ChatRow

export const ChatRowContent = ({
	message,
	lastModifiedMessage,
	isExpanded,
	isLast,
	isStreaming,
	onToggleExpand,
	onSuggestionClick,
}: ChatRowContentProps) => {
	const { t } = useTranslation()
	const { mcpServers, alwaysAllowMcp, currentCheckpoint } = useExtensionState()
	const [reasoningCollapsed, setReasoningCollapsed] = useState(true)
	const [isDiffErrorExpanded, setIsDiffErrorExpanded] = useState(false)
	const [showCopySuccess, setShowCopySuccess] = useState(false)
	const { copyWithFeedback } = useCopyToClipboard()

	const [cost, apiReqCancelReason, apiReqStreamingFailedMessage] = useMemo(() => {
		if (message.text !== null && message.text !== undefined && message.say === "api_req_started") {
			const info = safeJsonParse<ClineApiReqInfo>(message.text)
			return [info?.cost, info?.cancelReason, info?.streamingFailedMessage]
		}

		return [undefined, undefined, undefined]
	}, [message.text, message.say])

	// When resuming task, last wont be api_req_failed but a resume_task
	// message, so api_req_started will show loading spinner. That's why we just
	// remove the last api_req_started that failed without streaming anything.
	const apiRequestFailedMessage =
		isLast && lastModifiedMessage?.ask === "api_req_failed" // if request is retried then the latest message is a api_req_retried
			? lastModifiedMessage?.text
			: undefined

	const isCommandExecuting =
		isLast && lastModifiedMessage?.ask === "command" && lastModifiedMessage?.text?.includes(COMMAND_OUTPUT_STRING)

	const isMcpServerResponding = isLast && lastModifiedMessage?.say === "mcp_server_request_started"

	const type = message.type === "ask" ? message.ask : message.say

	const [icon, title] = useMemo((): [React.ReactNode | null, React.ReactNode | null] => {
		switch (type) {
			case "error":
				return [
					<span className="codicon codicon-error text-vscode-errorForeground mb-[-1.5px]" />,
					<span className="font-bold text-vscode-errorForeground">{t("chat:error")}</span>,
				]
			case "mistake_limit_reached":
				return [
					<span className="codicon codicon-error text-vscode-errorForeground mb-[-1.5px]" />, // Self-closing
					<span className="font-bold text-vscode-errorForeground">{t("chat:troubleMessage")}</span>,
				]
			case "command":
				return [
					isCommandExecuting ? (
						<ProgressIndicator />
					) : (
						<span className="codicon codicon-terminal text-vscode-foreground mb-[-1.5px]" /> // Self-closing
					),
					<span className="font-bold text-vscode-foreground">{t("chat:runCommand.title")}:</span>,
				]
			case "use_mcp_server":
				const mcpServerUse = safeJsonParse<ClineAskUseMcpServer>(message.text)
				if (mcpServerUse === undefined) {
					return [null, null]
				}
				return [
					isMcpServerResponding ? (
						<ProgressIndicator />
					) : (
						<span className="codicon codicon-server text-vscode-foreground mb-[-1.5px]" /> // Self-closing
					),
					<span className="font-bold text-vscode-foreground">
						{mcpServerUse.type === "use_mcp_tool"
							? t("chat:mcp.wantsToUseTool", { serverName: mcpServerUse.serverName })
							: t("chat:mcp.wantsToAccessResource", { serverName: mcpServerUse.serverName })}
					</span>,
				]
			case "completion_result":
				return [
					<span className="codicon codicon-check text-vscode-charts-green mb-[-1.5px]" />, // Self-closing
					<span className="font-bold text-vscode-charts-green">{t("chat:taskCompleted")}</span>,
				]
			case "api_req_retry_delayed":
				return [null, null] // Explicitly return [null, null] for this case
			case "api_req_started":
				const getIconSpan = (iconName: string, colorClassName: string) => (
					<div className="w-4 h-4 flex items-center justify-center">
						<span className={`codicon codicon-${iconName} ${colorClassName} text-[16px] mb-[-1.5px]`} />
					</div>
				)
				return [
					apiReqCancelReason !== null && apiReqCancelReason !== undefined ? (
						apiReqCancelReason === "user_cancelled" ? (
							getIconSpan("error", "text-vscode-descriptionForeground")
						) : (
							getIconSpan("error", "text-vscode-errorForeground")
						)
					) : cost !== null && cost !== undefined ? (
						getIconSpan("check", "text-vscode-charts-green")
					) : apiRequestFailedMessage ? (
						getIconSpan("error", "text-vscode-errorForeground")
					) : (
						<ProgressIndicator />
					),
					apiReqCancelReason !== null && apiReqCancelReason !== undefined ? (
						apiReqCancelReason === "user_cancelled" ? (
							<span className="font-bold text-vscode-foreground">{t("chat:apiRequest.cancelled")}</span>
						) : (
							<span className="font-bold text-vscode-errorForeground">
								{t("chat:apiRequest.streamingFailed")}
							</span>
						)
					) : cost !== null && cost !== undefined ? (
						<span className="font-bold text-vscode-foreground">{t("chat:apiRequest.title")}</span>
					) : apiRequestFailedMessage ? (
						<span className="font-bold text-vscode-errorForeground">{t("chat:apiRequest.failed")}</span>
					) : (
						<span className="font-bold text-vscode-foreground">{t("chat:apiRequest.streaming")}</span>
					),
				]
			case "followup":
				return [
					<span className="codicon codicon-question text-vscode-foreground mb-[-1.5px]" />,
					<span className="font-bold text-vscode-foreground">{t("chat:questions.hasQuestion")}</span>,
				]
			default:
				return [null, null] // Explicitly return [null, null] for default case
		}
	}, [type, isCommandExecuting, message, isMcpServerResponding, apiReqCancelReason, cost, apiRequestFailedMessage, t])

	const headerClasses = "flex items-center gap-[10px] mb-[10px] break-words"
	const pClasses = "m-0 whitespace-pre-wrap break-words overflow-anywhere"

	const tool = useMemo(
		() => (message.ask === "tool" ? safeJsonParse<ClineSayTool>(message.text) : null),
		[message.ask, message.text],
	)

	const followUpData = useMemo(() => {
		if (message.type === "ask" && message.ask === "followup" && !message.partial) {
			return safeJsonParse<any>(message.text)
		}
		return null
	}, [message.type, message.ask, message.partial, message.text])

	if (tool) {
		const toolIcon = (name: string) => (
			<span className={`codicon codicon-${name} text-vscode-foreground mb-[-1.5px]`} /> // Converted to Tailwind & self-closing
		)

		switch (tool.tool) {
			case "editedExistingFile":
			case "appliedDiff":
				return (
					<>
						<div className={headerClasses}>
							{toolIcon(tool.tool === "appliedDiff" ? "diff" : "edit")}
							<span className="font-bold">
								{tool.isOutsideWorkspace
									? t("chat:fileOperations.wantsToEditOutsideWorkspace")
									: t("chat:fileOperations.wantsToEdit")}
							</span>
						</div>
						<CodeAccordian
							progressStatus={message.progressStatus}
							isLoading={message.partial}
							diff={tool.diff!}
							path={tool.path!}
							isExpanded={isExpanded}
							onToggleExpand={onToggleExpand}
						/>
					</>
				)
			case "insertContent":
				return (
					<>
						<div className={headerClasses}>
							{toolIcon("insert")}
							<span className="font-bold">
								{tool.isOutsideWorkspace
									? t("chat:fileOperations.wantsToEditOutsideWorkspace")
									: tool.lineNumber === 0
										? t("chat:fileOperations.wantsToInsertAtEnd")
										: t("chat:fileOperations.wantsToInsertWithLineNumber", {
												lineNumber: tool.lineNumber,
											})}
							</span>
						</div>
						<CodeAccordian
							progressStatus={message.progressStatus}
							isLoading={message.partial}
							diff={tool.diff!}
							path={tool.path!}
							isExpanded={isExpanded}
							onToggleExpand={onToggleExpand}
						/>
					</>
				)
			case "searchAndReplace":
				return (
					<>
						<div className={headerClasses}>
							{toolIcon("replace")}
							<span className="font-bold">
								{message.type === "ask"
									? t("chat:fileOperations.wantsToSearchReplace")
									: t("chat:fileOperations.didSearchReplace")}
							</span>
						</div>
						<CodeAccordian
							progressStatus={message.progressStatus}
							isLoading={message.partial}
							diff={tool.diff!}
							path={tool.path!}
							isExpanded={isExpanded}
							onToggleExpand={onToggleExpand}
						/>
					</>
				)
			case "newFileCreated":
				return (
					<>
						<div className={headerClasses}>
							{toolIcon("new-file")}
							<span className="font-bold">{t("chat:fileOperations.wantsToCreate")}</span>
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
						<div className={headerClasses}>
							{toolIcon("file-code")}
							<span className="font-bold">
								{message.type === "ask"
									? tool.isOutsideWorkspace
										? t("chat:fileOperations.wantsToReadOutsideWorkspace")
										: t("chat:fileOperations.wantsToRead")
									: t("chat:fileOperations.didRead")}
							</span>
						</div>
						<div className="rounded-[3px] overflow-hidden border border-vscode-editorGroup-border bg-vscode-code-block-background">
							<div
								className="text-vscode-descriptionForeground flex items-center p-[9px_10px] cursor-pointer select-none"
								onClick={() => {
									vscode.postMessage({ type: "openFile", text: tool.content })
								}}>
								{tool.path?.startsWith(".") && <span>.</span>}
								<span className="whitespace-nowrap overflow-hidden text-ellipsis mr-2 rtl text-left">
									{removeLeadingNonAlphanumeric(tool.path ?? "") + "\u200E"}
									{tool.reason}
								</span>
								<div className="flex-grow"></div>
								<span className="codicon codicon-link-external text-[13.5px] m-[1px_0]"></span>
							</div>
						</div>
					</>
				)
			case "fetchInstructions":
				return (
					<>
						<div className={headerClasses}>
							{toolIcon("file-code")}
							<span className="font-bold">{t("chat:instructions.wantsToFetch")}</span>
						</div>
						<CodeAccordian
							isLoading={message.partial}
							code={tool.content!}
							isExpanded={isExpanded}
							onToggleExpand={onToggleExpand}
						/>
					</>
				)
			case "listFilesTopLevel":
				return (
					<>
						<div className={headerClasses}>
							{toolIcon("folder-opened")}
							<span className="font-bold">
								{message.type === "ask"
									? t("chat:directoryOperations.wantsToViewTopLevel")
									: t("chat:directoryOperations.didViewTopLevel")}
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
						<div className={headerClasses}>
							{toolIcon("folder-opened")}
							<span className="font-bold">
								{message.type === "ask"
									? t("chat:directoryOperations.wantsToViewRecursive")
									: t("chat:directoryOperations.didViewRecursive")}
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
						<div className={headerClasses}>
							{toolIcon("file-code")}
							<span className="font-bold">
								{message.type === "ask"
									? t("chat:directoryOperations.wantsToViewDefinitions")
									: t("chat:directoryOperations.didViewDefinitions")}
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
						<div className={headerClasses}>
							{toolIcon("search")}
							<span className="font-bold">
								{message.type === "ask" ? (
									<Trans
										i18nKey="chat:directoryOperations.wantsToSearch"
										components={{ code: <code>{tool.regex}</code> }}
										values={{ regex: tool.regex }}
									/>
								) : (
									<Trans
										i18nKey="chat:directoryOperations.didSearch"
										components={{ code: <code>{tool.regex}</code> }}
										values={{ regex: tool.regex }}
									/>
								)}
							</span>
						</div>
						<CodeAccordian
							code={tool.content!}
							path={tool.path! + (tool.filePattern ? `/(${tool.filePattern})` : "")}
							language="log"
							isExpanded={isExpanded}
							onToggleExpand={onToggleExpand}
						/>
					</>
				)
			case "switchMode":
				return (
					<>
						<div className={headerClasses}>
							{toolIcon("symbol-enum")}
							<span className="font-bold">
								{message.type === "ask" ? (
									<>
										{tool.reason ? (
											<Trans
												i18nKey="chat:modes.wantsToSwitchWithReason"
												components={{ code: <code>{tool.mode}</code> }}
												values={{ mode: tool.mode, reason: tool.reason }}
											/>
										) : (
											<Trans
												i18nKey="chat:modes.wantsToSwitch"
												components={{ code: <code>{tool.mode}</code> }}
												values={{ mode: tool.mode }}
											/>
										)}
									</>
								) : (
									<>
										{tool.reason ? (
											<Trans
												i18nKey="chat:modes.didSwitchWithReason"
												components={{ code: <code>{tool.mode}</code> }}
												values={{ mode: tool.mode, reason: tool.reason }}
											/>
										) : (
											<Trans
												i18nKey="chat:modes.didSwitch"
												components={{ code: <code>{tool.mode}</code> }}
												values={{ mode: tool.mode }}
											/>
										)}
									</>
								)}
							</span>
						</div>
					</>
				)
			case "newTask":
				return (
					<>
						<div className={headerClasses}>
							{toolIcon("tasklist")}
							<span className="font-bold">
								<Trans
									i18nKey="chat:subtasks.wantsToCreate"
									components={{ code: <code>{tool.mode}</code> }}
									values={{ mode: tool.mode }}
								/>
							</span>
						</div>
						<div
							style={{
								marginTop: "4px",
								backgroundColor: "var(--vscode-badge-background)",
								border: "1px solid var(--vscode-badge-background)",
								borderRadius: "4px 4px 0 0",
								overflow: "hidden",
								marginBottom: "2px",
							}}>
							<div
								style={{
									padding: "9px 10px 9px 14px",
									backgroundColor: "var(--vscode-badge-background)",
									borderBottom: "1px solid var(--vscode-editorGroup-border)",
									fontWeight: "bold",
									fontSize: "var(--vscode-font-size)",
									color: "var(--vscode-badge-foreground)",
									display: "flex",
									alignItems: "center",
									gap: "6px",
								}}>
								<span className="codicon codicon-arrow-right"></span>
								{t("chat:subtasks.newTaskContent")}
							</div>
							<div style={{ padding: "12px 16px", backgroundColor: "var(--vscode-editor-background)" }}>
								<MarkdownBlock markdown={tool.content} />
							</div>
						</div>
					</>
				)
			case "finishTask":
				return (
					<>
						<div className={headerClasses}>
							{toolIcon("check-all")}
							<span className="font-bold">{t("chat:subtasks.wantsToFinish")}</span>
						</div>
						<div
							style={{
								marginTop: "4px",
								backgroundColor: "var(--vscode-editor-background)",
								border: "1px solid var(--vscode-badge-background)",
								borderRadius: "4px",
								overflow: "hidden",
								marginBottom: "8px",
							}}>
							<div
								style={{
									padding: "9px 10px 9px 14px",
									backgroundColor: "var(--vscode-badge-background)",
									borderBottom: "1px solid var(--vscode-editorGroup-border)",
									fontWeight: "bold",
									fontSize: "var(--vscode-font-size)",
									color: "var(--vscode-badge-foreground)",
									display: "flex",
									alignItems: "center",
									gap: "6px",
								}}>
								<span className="codicon codicon-check"></span>
								{t("chat:subtasks.completionContent")}
							</div>
							<div style={{ padding: "12px 16px", backgroundColor: "var(--vscode-editor-background)" }}>
								<MarkdownBlock markdown={t("chat:subtasks.completionInstructions")} />
							</div>
						</div>
					</>
				)
			default:
				return null
		}
	}

	switch (message.type) {
		case "say":
			switch (message.say) {
				case "diff_error":
					return (
						<div>
							<div
								style={{
									marginTop: "0px",
									overflow: "hidden",
									marginBottom: "8px",
								}}>
								<div
									style={{
										borderBottom: isDiffErrorExpanded
											? "1px solid var(--vscode-editorGroup-border)"
											: "none",
										fontWeight: "normal",
										fontSize: "var(--vscode-font-size)",
										color: "var(--vscode-editor-foreground)",
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										cursor: "pointer",
									}}
									onClick={() => setIsDiffErrorExpanded(!isDiffErrorExpanded)}>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: "10px",
											flexGrow: 1,
										}}>
										<span
											className="codicon codicon-warning"
											style={{
												color: "var(--vscode-editorWarning-foreground)",
												opacity: 0.8,
												fontSize: 16,
												marginBottom: "-1.5px",
											}}></span>
										<span style={{ fontWeight: "bold" }}>{t("chat:diffError.title")}</span>
									</div>
									<div style={{ display: "flex", alignItems: "center" }}>
										<VSCodeButton
											appearance="icon"
											style={{
												padding: "3px",
												height: "24px",
												marginRight: "4px",
												color: "var(--vscode-editor-foreground)",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												background: "transparent",
											}}
											onClick={(e) => {
												e.stopPropagation()

												// Call copyWithFeedback and handle the Promise
												copyWithFeedback(message.text || "").then((success) => {
													if (success) {
														// Show checkmark
														setShowCopySuccess(true)

														// Reset after a brief delay
														setTimeout(() => {
															setShowCopySuccess(false)
														}, 1000)
													}
												})
											}}>
											<span
												className={`codicon codicon-${showCopySuccess ? "check" : "copy"}`}></span>
										</VSCodeButton>
										<span
											className={`codicon codicon-chevron-${isDiffErrorExpanded ? "up" : "down"}`}></span>
									</div>
								</div>
								{isDiffErrorExpanded && (
									<div
										style={{
											padding: "8px",
											backgroundColor: "var(--vscode-editor-background)",
											borderTop: "none",
										}}>
										<CodeBlock source={`${"```"}plaintext\n${message.text || ""}\n${"```"}`} />
									</div>
								)}
							</div>
						</div>
					)
				case "subtask_result":
					return (
						<div>
							<div
								style={{
									marginTop: "0px",
									backgroundColor: "var(--vscode-badge-background)",
									border: "1px solid var(--vscode-badge-background)",
									borderRadius: "0 0 4px 4px",
									overflow: "hidden",
									marginBottom: "8px",
								}}>
								<div
									style={{
										padding: "9px 10px 9px 14px",
										backgroundColor: "var(--vscode-badge-background)",
										borderBottom: "1px solid var(--vscode-editorGroup-border)",
										fontWeight: "bold",
										fontSize: "var(--vscode-font-size)",
										color: "var(--vscode-badge-foreground)",
										display: "flex",
										alignItems: "center",
										gap: "6px",
									}}>
									<span className="codicon codicon-arrow-left"></span>
									{t("chat:subtasks.resultContent")}
								</div>
								<div
									style={{
										padding: "12px 16px",
										backgroundColor: "var(--vscode-editor-background)",
									}}>
									<MarkdownBlock markdown={message.text} />
								</div>
							</div>
						</div>
					)
				case "reasoning":
					return (
						<ReasoningBlock
							content={message.text || ""}
							elapsed={isLast && isStreaming ? Date.now() - message.ts : undefined}
							isCollapsed={reasoningCollapsed}
							onToggleCollapse={() => setReasoningCollapsed(!reasoningCollapsed)}
						/>
					)
				case "api_req_started":
					return (
						<>
							<div
								className={cn(
									headerClasses,
									"justify-between cursor-pointer select-none",
									((cost === null || cost === undefined) && apiRequestFailedMessage) ||
										apiReqStreamingFailedMessage
										? "mb-[10px]"
										: "mb-0",
								)}
								onClick={onToggleExpand}>
								<div className="flex items-center gap-[10px] flex-grow">
									{icon}
									{title}
									<VSCodeBadge
										style={{ opacity: cost !== null && cost !== undefined && cost > 0 ? 1 : 0 }}>
										${Number(cost || 0)?.toFixed(4)}
									</VSCodeBadge>
								</div>
								<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></span>
							</div>
							{(((cost === null || cost === undefined) && apiRequestFailedMessage) ||
								apiReqStreamingFailedMessage) && (
								<>
									<p className={cn(pClasses, "text-vscode-errorForeground")}>
										{apiRequestFailedMessage || apiReqStreamingFailedMessage}
										{apiRequestFailedMessage?.toLowerCase().includes("powershell") && (
											<>
												<br />
												<br />
												{t("chat:powershell.issues")}{" "}
												<a
													href="https://github.com/cline/cline/wiki/TroubleShooting-%E2%80%90-%22PowerShell-is-not-recognized-as-an-internal-or-external-command%22"
													style={{ color: "inherit", textDecoration: "underline" }}>
													troubleshooting guide
												</a>
												.
											</>
										)}
									</p>
								</>
							)}

							{isExpanded && (
								<div style={{ marginTop: "10px" }}>
									<CodeAccordian
										code={safeJsonParse<any>(message.text)?.request}
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
				case "text":
					return (
						<div>
							<Markdown markdown={message.text} partial={message.partial} />
						</div>
					)
				case "user_feedback":
					return (
						<div className="bg-vscode-editor-background border rounded-xs p-1 overflow-hidden whitespace-pre-wrap word-break-break-word overflow-wrap-anywhere">
							<div className="flex justify-between gap-2">
								<div className="flex-grow px-2 py-1">
									<Mention text={message.text} withShadow />
								</div>
								<Button
									variant="ghost"
									size="icon"
									disabled={isStreaming}
									onClick={(e) => {
										e.stopPropagation()
										vscode.postMessage({ type: "deleteMessage", value: message.ts })
									}}>
									<span className="codicon codicon-trash" />
								</Button>
							</div>
							{message.images && message.images.length > 0 && (
								<Thumbnails images={message.images} style={{ marginTop: "8px" }} />
							)}
						</div>
					)
				case "user_feedback_diff":
					const tool = safeJsonParse<ClineSayTool>(message.text)
					return (
						<div
							style={{
								marginTop: -10,
								width: "100%",
							}}>
							<CodeAccordian
								diff={tool?.diff!}
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
								<div className={headerClasses}>
									{icon}
									{title}
								</div>
							)}
							<p className={cn(pClasses, "text-vscode-errorForeground")}>{message.text}</p>
						</>
					)
				case "completion_result":
					return (
						<>
							<div className={headerClasses}>
								{icon}
								{title}
							</div>
							<div className="text-vscode-charts-green pt-[10px]">
								<Markdown markdown={message.text} />
							</div>
						</>
					)
				case "shell_integration_warning":
					return <CommandExecutionError />
				case "mcp_server_response":
					return (
						<>
							<div className="pt-0">
								<div className="mb-1 opacity-80 text-xs uppercase">{t("chat:response")}</div>
								<CodeAccordian
									code={message.text}
									language="json"
									isExpanded={true}
									onToggleExpand={onToggleExpand}
								/>
							</div>
						</>
					)
				case "checkpoint_saved":
					return (
						<CheckpointSaved
							ts={message.ts!}
							commitHash={message.text!}
							currentHash={currentCheckpoint}
							checkpoint={message.checkpoint}
						/>
					)
				default:
					return (
						<>
							{title && (
								<div className={headerClasses}>
									{icon}
									{title}
								</div>
							)}
							<div className="pt-[10px]">
								<Markdown markdown={message.text} partial={message.partial} />
							</div>
						</>
					)
			}
		case "ask":
			switch (message.ask) {
				case "mistake_limit_reached":
					return (
						<>
							<div className={headerClasses}>
								{icon}
								{title}
							</div>
							<p className={cn(pClasses, "text-vscode-errorForeground")}>{message.text}</p>
						</>
					)
				case "command":
					return (
						<>
							<div className={headerClasses}>
								{icon}
								{title}
							</div>
							<CommandExecution executionId={message.ts.toString()} text={message.text} />
						</>
					)
				case "use_mcp_server":
					const useMcpServer = safeJsonParse<ClineAskUseMcpServer>(message.text)

					if (!useMcpServer) {
						return null
					}

					const server = mcpServers.find((server) => server.name === useMcpServer.serverName)

					return (
						<>
							<div className={headerClasses}>
								{icon}
								{title}
							</div>
							<div className="bg-vscode-textCodeBlock-background rounded-[3px] p-[8px_10px] mt-2">
								{useMcpServer.type === "access_mcp_resource" && (
									<McpResourceRow
										item={{
											// Use the matched resource/template details, with fallbacks
											...(findMatchingResourceOrTemplate(
												useMcpServer.uri || "",
												server?.resources,
												server?.resourceTemplates,
											) || {
												name: "",
												mimeType: "",
												description: "",
											}),
											// Always use the actual URI from the request
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
														server?.tools?.find(
															(tool) => tool.name === useMcpServer.toolName,
														)?.description || "",
													alwaysAllow:
														server?.tools?.find(
															(tool) => tool.name === useMcpServer.toolName,
														)?.alwaysAllow || false,
												}}
												serverName={useMcpServer.serverName}
												alwaysAllowMcp={alwaysAllowMcp}
											/>
										</div>
										{useMcpServer.arguments && useMcpServer.arguments !== "{}" && (
											<div className="mt-2">
												<div className="mb-1 opacity-80 text-xs uppercase">
													{t("chat:arguments")}
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
				case "completion_result":
					if (message.text) {
						return (
							<div>
								<div className={headerClasses}>
									{icon}
									{title}
								</div>
								<div className="text-vscode-charts-green pt-[10px]">
									<Markdown markdown={message.text} partial={message.partial} />
								</div>
							</div>
						)
					} else {
						return null // Don't render anything when we get a completion_result ask without text
					}
				case "followup":
					return (
						<>
							{title && (
								<div className={headerClasses}>
									{icon}
									{title}
								</div>
							)}
							<div className="pt-[10px] pb-[15px]">
								<p className={pClasses}>
									{message.partial === true ? message?.text : followUpData?.question}
								</p>
							</div>
							<FollowUpSuggest
								suggestions={followUpData?.suggest}
								onSuggestionClick={onSuggestionClick}
								ts={message?.ts}
							/>
						</>
					)
				default:
					return null
			}
	}
}

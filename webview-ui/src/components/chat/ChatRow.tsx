import { VSCodeBadge, VSCodeButton, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import deepEqual from "fast-deep-equal"
import React, { memo, useEffect, useMemo, useRef, useState } from "react"
import { useSize } from "react-use"
import {
	ClineApiReqInfo,
	ClineAskUseMcpServer,
	ClineMessage,
	ClineSayTool,
} from "../../../../src/shared/ExtensionMessage"
import { COMMAND_OUTPUT_STRING } from "../../../../src/shared/combineCommandSequences"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { findMatchingResourceOrTemplate } from "../../utils/mcp"
import { vscode } from "../../utils/vscode"
import CodeAccordian, { removeLeadingNonAlphanumeric } from "../common/CodeAccordian"
import CodeBlock, { CODE_BLOCK_BG_COLOR } from "../common/CodeBlock"
import MarkdownBlock from "../common/MarkdownBlock"
import Thumbnails from "../common/Thumbnails"
import McpResourceRow from "../mcp/McpResourceRow"
import McpToolRow from "../mcp/McpToolRow"
import { highlightMentions } from "./TaskHeader"

interface ChatRowProps {
	message: ClineMessage
	isExpanded: boolean
	onToggleExpand: () => void
	lastModifiedMessage?: ClineMessage
	isLast: boolean
	onHeightChange: (isTaller: boolean) => void
	isStreaming: boolean
}

interface ChatRowContentProps extends Omit<ChatRowProps, "onHeightChange"> {}

const ChatRow = memo(
	(props: ChatRowProps) => {
		const { isLast, onHeightChange, message } = props
		// Store the previous height to compare with the current height
		// This allows us to detect changes without causing re-renders
		const prevHeightRef = useRef(0)

		const [chatrow, { height }] = useSize(
			<div
				style={{
					padding: "10px 6px 10px 15px",
				}}>
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
	isExpanded,
	onToggleExpand,
	lastModifiedMessage,
	isLast,
	isStreaming,
}: ChatRowContentProps) => {
	const { mcpServers } = useExtensionState()
	const [cost, apiReqCancelReason, apiReqStreamingFailedMessage] = useMemo(() => {
		if (message.text != null && message.say === "api_req_started") {
			const info: ClineApiReqInfo = JSON.parse(message.text)
			return [info.cost, info.cancelReason, info.streamingFailedMessage]
		}
		return [undefined, undefined, undefined]
	}, [message.text, message.say])
	// when resuming task, last wont be api_req_failed but a resume_task message, so api_req_started will show loading spinner. that's why we just remove the last api_req_started that failed without streaming anything
	const apiRequestFailedMessage =
		isLast && lastModifiedMessage?.ask === "api_req_failed" // if request is retried then the latest message is a api_req_retried
			? lastModifiedMessage?.text
			: undefined
	const isCommandExecuting =
		isLast && lastModifiedMessage?.ask === "command" && lastModifiedMessage?.text?.includes(COMMAND_OUTPUT_STRING)

	const isMcpServerResponding = isLast && lastModifiedMessage?.say === "mcp_server_request_started"

	const type = message.type === "ask" ? message.ask : message.say

	const normalColor = "var(--vscode-foreground)"
	const errorColor = "var(--vscode-errorForeground)"
	const successColor = "var(--vscode-charts-green)"
	const cancelledColor = "var(--vscode-descriptionForeground)"

	const [icon, title] = useMemo(() => {
		switch (type) {
			case "error":
				return [
					<span
						className="codicon codicon-error"
						style={{ color: errorColor, marginBottom: "-1.5px" }}></span>,
					<span style={{ color: errorColor, fontWeight: "bold" }}>Error</span>,
				]
			case "mistake_limit_reached":
				return [
					<span
						className="codicon codicon-error"
						style={{ color: errorColor, marginBottom: "-1.5px" }}></span>,
					<span style={{ color: errorColor, fontWeight: "bold" }}>Cline is having trouble...</span>,
				]
			case "command":
				return [
					isCommandExecuting ? (
						<ProgressIndicator />
					) : (
						<span
							className="codicon codicon-terminal"
							style={{ color: normalColor, marginBottom: "-1.5px" }}></span>
					),
					<span style={{ color: normalColor, fontWeight: "bold" }}>
						Cline wants to execute this command:
					</span>,
				]
			case "use_mcp_server":
				const mcpServerUse = JSON.parse(message.text || "{}") as ClineAskUseMcpServer
				return [
					isMcpServerResponding ? (
						<ProgressIndicator />
					) : (
						<span
							className="codicon codicon-server"
							style={{ color: normalColor, marginBottom: "-1.5px" }}></span>
					),
					<span style={{ color: normalColor, fontWeight: "bold" }}>
						Cline wants to {mcpServerUse.type === "use_mcp_tool" ? "use a tool" : "access a resource"} on
						the <code>{mcpServerUse.serverName}</code> MCP server:
					</span>,
				]
			case "completion_result":
				return [
					<span
						className="codicon codicon-check"
						style={{ color: successColor, marginBottom: "-1.5px" }}></span>,
					<span style={{ color: successColor, fontWeight: "bold" }}>Task Completed</span>,
				]
			case "api_req_retry_delayed":
				return []
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
					apiReqCancelReason != null ? (
						apiReqCancelReason === "user_cancelled" ? (
							<span style={{ color: normalColor, fontWeight: "bold" }}>API Request Cancelled</span>
						) : (
							<span style={{ color: errorColor, fontWeight: "bold" }}>API Streaming Failed</span>
						)
					) : cost != null ? (
						<span style={{ color: normalColor, fontWeight: "bold" }}>API Request</span>
					) : apiRequestFailedMessage ? (
						<span style={{ color: errorColor, fontWeight: "bold" }}>API Request Failed</span>
					) : (
						<span style={{ color: normalColor, fontWeight: "bold" }}>API Request...</span>
					),
				]
			case "followup":
				return [
					<span
						className="codicon codicon-question"
						style={{ color: normalColor, marginBottom: "-1.5px" }}></span>,
					<span style={{ color: normalColor, fontWeight: "bold" }}>Cline has a question:</span>,
				]
			default:
				return [null, null]
		}
	}, [type, isCommandExecuting, message, isMcpServerResponding, apiReqCancelReason, cost, apiRequestFailedMessage])

	const headerStyle: React.CSSProperties = {
		display: "flex",
		alignItems: "center",
		gap: "10px",
		marginBottom: "10px",
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
		const toolIcon = (name: string) => (
			<span
				className={`codicon codicon-${name}`}
				style={{ color: "var(--vscode-foreground)", marginBottom: "-1.5px" }}></span>
		)

		switch (tool.tool) {
			case "editedExistingFile":
			case "appliedDiff":
				return (
					<>
						<div style={headerStyle}>
							{toolIcon(tool.tool === "appliedDiff" ? "diff" : "edit")}
							<span style={{ fontWeight: "bold" }}>Cline wants to edit this file:</span>
						</div>
						<CodeAccordian
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
						<div style={headerStyle}>
							{toolIcon("new-file")}
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
							<span style={{ fontWeight: "bold" }}>
								{message.type === "ask" ? "Cline wants to read this file:" : "Cline read this file:"}
							</span>
						</div>
						{/* <CodeAccordian
							code={tool.content!}
							path={tool.path!}
							isExpanded={isExpanded}
							onToggleExpand={onToggleExpand}
						/> */}
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
									vscode.postMessage({ type: "openFile", text: tool.content })
								}}>
								{tool.path?.startsWith(".") && <span>.</span>}
								<span
									style={{
										whiteSpace: "nowrap",
										overflow: "hidden",
										textOverflow: "ellipsis",
										marginRight: "8px",
										direction: "rtl",
										textAlign: "left",
									}}>
									{removeLeadingNonAlphanumeric(tool.path ?? "") + "\u200E"}
								</span>
								<div style={{ flexGrow: 1 }}></div>
								<span
									className={`codicon codicon-link-external`}
									style={{ fontSize: 13.5, margin: "1px 0" }}></span>
							</div>
						</div>
					</>
				)
			case "listFilesTopLevel":
				return (
					<>
						<div style={headerStyle}>
							{toolIcon("folder-opened")}
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
							<span style={{ fontWeight: "bold" }}>
								{message.type === "ask" ? (
									<>
										Cline wants to search this directory for <code>{tool.regex}</code>:
									</>
								) : (
									<>
										Cline searched this directory for <code>{tool.regex}</code>:
									</>
								)}
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
			// case "inspectSite":
			// 	const isInspecting =
			// 		isLast && lastModifiedMessage?.say === "inspect_site_result" && !lastModifiedMessage?.images
			// 	return (
			// 		<>
			// 			<div style={headerStyle}>
			// 				{isInspecting ? <ProgressIndicator /> : toolIcon("inspect")}
			// 				<span style={{ fontWeight: "bold" }}>
			// 					{message.type === "ask" ? (
			// 						<>Cline wants to inspect this website:</>
			// 					) : (
			// 						<>Cline is inspecting this website:</>
			// 					)}
			// 				</span>
			// 			</div>
			// 			<div
			// 				style={{
			// 					borderRadius: 3,
			// 					border: "1px solid var(--vscode-editorGroup-border)",
			// 					overflow: "hidden",
			// 					backgroundColor: CODE_BLOCK_BG_COLOR,
			// 				}}>
			// 				<CodeBlock source={`${"```"}shell\n${tool.path}\n${"```"}`} forceWrap={true} />
			// 			</div>
			// 		</>
			// 	)
			default:
				return null
		}
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
										(cost == null && apiRequestFailedMessage) || apiReqStreamingFailedMessage
											? 10
											: 0,
									justifyContent: "space-between",
									cursor: "pointer",
									userSelect: "none",
									WebkitUserSelect: "none",
									MozUserSelect: "none",
									msUserSelect: "none",
								}}
								onClick={onToggleExpand}>
								<div style={{ display: "flex", alignItems: "center", gap: "10px", flexGrow: 1 }}>
									{icon}
									{title}
									<VSCodeBadge style={{ opacity: cost != null && cost > 0 ? 1 : 0 }}>
										${Number(cost || 0)?.toFixed(4)}
									</VSCodeBadge>
								</div>
								<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></span>
							</div>
							{((cost == null && apiRequestFailedMessage) || apiReqStreamingFailedMessage) && (
								<>
									<p style={{ ...pStyle, color: "var(--vscode-errorForeground)" }}>
										{apiRequestFailedMessage || apiReqStreamingFailedMessage}
										{apiRequestFailedMessage?.toLowerCase().includes("powershell") && (
											<>
												<br />
												<br />
												It seems like you're having Windows PowerShell issues, please see this{" "}
												<a
													href="https://github.com/cline/cline/wiki/TroubleShooting-%E2%80%90-%22PowerShell-is-not-recognized-as-an-internal-or-external-command%22"
													style={{ color: "inherit", textDecoration: "underline" }}>
													troubleshooting guide
												</a>
												.
											</>
										)}
									</p>

									{/* {apiProvider === "" && (
											<div
												style={{
													display: "flex",
													alignItems: "center",
													backgroundColor:
														"color-mix(in srgb, var(--vscode-errorForeground) 20%, transparent)",
													color: "var(--vscode-editor-foreground)",
													padding: "6px 8px",
													borderRadius: "3px",
													margin: "10px 0 0 0",
													fontSize: "12px",
												}}>
												<i
													className="codicon codicon-warning"
													style={{
														marginRight: 6,
														fontSize: 16,
														color: "var(--vscode-errorForeground)",
													}}></i>
												<span>
													Uh-oh, this could be a problem on end. We've been alerted and
													will resolve this ASAP. You can also{" "}
													<a
														href=""
														style={{ color: "inherit", textDecoration: "underline" }}>
														contact us
													</a>
													.
												</span>
											</div>
										)} */}
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
				case "text":
					return (
						<div>
							<Markdown markdown={message.text} partial={message.partial} />
						</div>
					)
				case "user_feedback":
					return (
						<div
							style={{
								backgroundColor: "var(--vscode-badge-background)",
								color: "var(--vscode-badge-foreground)",
								borderRadius: "3px",
								padding: "9px",
								whiteSpace: "pre-line",
								wordWrap: "break-word",
							}}>
							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
								<span style={{ display: "block", flexGrow: 1 }}>{highlightMentions(message.text)}</span>
								<VSCodeButton
									appearance="icon"
									style={{
										padding: "3px",
										flexShrink: 0,
										height: "24px",
										marginTop: "-6px",
										marginRight: "-6px"
									}}
									disabled={isStreaming}
									onClick={(e) => {
										e.stopPropagation();
										vscode.postMessage({
											type: "deleteMessage",
											value: message.ts
										});
									}}
								>
									<span className="codicon codicon-trash"></span>
								</VSCodeButton>
							</div>
							{message.images && message.images.length > 0 && (
								<Thumbnails images={message.images} style={{ marginTop: "8px" }} />
							)}
						</div>
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
							<p style={{ ...pStyle, color: "var(--vscode-errorForeground)" }}>{message.text}</p>
						</>
					)
				case "completion_result":
					return (
						<>
							<div style={headerStyle}>
								{icon}
								{title}
							</div>
							<div style={{ color: "var(--vscode-charts-green)", paddingTop: 10 }}>
								<Markdown markdown={message.text} />
							</div>
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
								<div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
									<i
										className="codicon codicon-warning"
										style={{
											marginRight: 8,
											fontSize: 18,
											color: "#FFA500",
										}}></i>
									<span style={{ fontWeight: 500, color: "#FFA500" }}>
										Shell Integration Unavailable
									</span>
								</div>
								<div>
									Cline won't be able to view the command's output. Please update VSCode (
									<code>CMD/CTRL + Shift + P</code> → "Update") and make sure you're using a supported
									shell: zsh, bash, fish, or PowerShell (<code>CMD/CTRL + Shift + P</code> →
									"Terminal: Select Default Profile").{" "}
									<a
										href="https://github.com/cline/cline/wiki/Troubleshooting-%E2%80%90-Shell-Integration-Unavailable"
										style={{ color: "inherit", textDecoration: "underline" }}>
										Still having trouble?
									</a>
								</div>
							</div>
						</>
					)
				case "mcp_server_response":
					return (
						<>
							<div style={{ paddingTop: 0 }}>
								<div
									style={{
										marginBottom: "4px",
										opacity: 0.8,
										fontSize: "12px",
										textTransform: "uppercase",
									}}>
									Response
								</div>
								<CodeAccordian
									code={message.text}
									language="json"
									isExpanded={true}
									onToggleExpand={onToggleExpand}
								/>
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
							<div style={headerStyle}>
								{icon}
								{title}
							</div>
							<p style={{ ...pStyle, color: "var(--vscode-errorForeground)" }}>{message.text}</p>
						</>
					)
				case "command":
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

					const { command, output } = splitMessage(message.text || "")
					return (
						<>
							<div style={headerStyle}>
								{icon}
								{title}
							</div>
							{/* <Terminal
								rawOutput={command + (output ? "\n" + output : "")}
								shouldAllowInput={!!isCommandExecuting && output.length > 0}
							/> */}
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
											<span
												className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`}></span>
											<span style={{ fontSize: "0.8em" }}>Command Output</span>
										</div>
										{isExpanded && <CodeBlock source={`${"```"}shell\n${output}\n${"```"}`} />}
									</div>
								)}
							</div>
						</>
					)
				case "use_mcp_server":
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
														server?.tools?.find((tool) => tool.name === useMcpServer.toolName)
															?.description || "",
													alwaysAllow: server?.tools?.find((tool) => tool.name === useMcpServer.toolName)
														?.alwaysAllow || false,
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
				case "completion_result":
					if (message.text) {
						return (
							<div>
								<div style={headerStyle}>
									{icon}
									{title}
								</div>
								<div style={{ color: "var(--vscode-charts-green)", paddingTop: 10 }}>
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
				default:
					return null
			}
	}
}

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

const Markdown = memo(({ markdown, partial }: { markdown?: string; partial?: boolean }) => {
	const [isHovering, setIsHovering] = useState(false);

	return (
		<div
			onMouseEnter={() => setIsHovering(true)}
			onMouseLeave={() => setIsHovering(false)}
			style={{ position: "relative" }}
		>
			<div style={{ wordBreak: "break-word", overflowWrap: "anywhere", marginBottom: -15, marginTop: -15 }}>
				<MarkdownBlock markdown={markdown} />
			</div>
			{markdown && !partial && isHovering && (
				<div
					style={{
						position: "absolute",
						bottom: "-4px",
						right: "8px",
						opacity: 0,
						animation: "fadeIn 0.2s ease-in-out forwards",
						borderRadius: "4px"
					}}
				>
					<style>
						{`
							@keyframes fadeIn {
								from { opacity: 0; }
								to { opacity: 1.0; }
							}
						`}
					</style>
					<VSCodeButton
						className="copy-button"
						appearance="icon"
						style={{
							height: "24px",
							border: "none",
							background: "var(--vscode-editor-background)",
							transition: "background 0.2s ease-in-out"
						}}
						onClick={() => {
							navigator.clipboard.writeText(markdown);
							// Flash the button background briefly to indicate success
							const button = document.activeElement as HTMLElement;
							if (button) {
								button.style.background = "var(--vscode-button-background)";
								setTimeout(() => {
									button.style.background = "";
								}, 200);
							}
						}}
						title="Copy as markdown"
					>
						<span className="codicon codicon-copy"></span>
					</VSCodeButton>
				</div>
			)}
		</div>
	)
})

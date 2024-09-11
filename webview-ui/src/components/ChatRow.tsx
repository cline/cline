import { VSCodeBadge, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import deepEqual from "fast-deep-equal"
import React, { memo, useMemo } from "react"
import ReactMarkdown from "react-markdown"
import { ClaudeMessage, ClaudeSayTool } from "../../../src/shared/ExtensionMessage"
import { COMMAND_OUTPUT_STRING } from "../../../src/shared/combineCommandSequences"
import CodeAccordian from "./CodeAccordian"
import CodeBlock, { CODE_BLOCK_BG_COLOR } from "./CodeBlock"
import Thumbnails from "./Thumbnails"

interface ChatRowProps {
	message: ClaudeMessage
	isExpanded: boolean
	onToggleExpand: () => void
	lastModifiedMessage?: ClaudeMessage
	isLast: boolean
}

const ChatRow = memo(
	(props: ChatRowProps) => {
		// we cannot return null as virtuoso does not support it, so we use a separate visibleMessages array to filter out messages that should not be rendered
		return (
			<div
				style={{
					padding: "10px 6px 10px 15px",
				}}>
				<ChatRowContent {...props} />
			</div>
		)
	},
	// memo does shallow comparison of props, so we need to do deep comparison of arrays/objects whose properties might change
	deepEqual
)

export default ChatRow

const ChatRowContent = ({ message, isExpanded, onToggleExpand, lastModifiedMessage, isLast }: ChatRowProps) => {
	const cost = useMemo(() => {
		if (message.text != null && message.say === "api_req_started") {
			return JSON.parse(message.text).cost
		}
		return undefined
	}, [message.text, message.say])
	const apiRequestFailedMessage =
		isLast && lastModifiedMessage?.ask === "api_req_failed" // if request is retried then the latest message is a api_req_retried
			? lastModifiedMessage?.text
			: undefined
	const isCommandExecuting =
		isLast && lastModifiedMessage?.ask === "command" && lastModifiedMessage?.text?.includes(COMMAND_OUTPUT_STRING)
	const type = message.type === "ask" ? message.ask : message.say

	const normalColor = "var(--vscode-foreground)"
	const errorColor = "var(--vscode-errorForeground)"
	const successColor = "var(--vscode-charts-green)"

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
					<span style={{ color: errorColor, fontWeight: "bold" }}>Claude is having trouble...</span>,
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
						Claude wants to execute this command:
					</span>,
				]
			case "completion_result":
				return [
					<span
						className="codicon codicon-check"
						style={{ color: successColor, marginBottom: "-1.5px" }}></span>,
					<span style={{ color: successColor, fontWeight: "bold" }}>Task Completed</span>,
				]
			case "api_req_started":
				return [
					cost != null ? (
						<span
							className="codicon codicon-check"
							style={{ color: successColor, marginBottom: "-1.5px" }}></span>
					) : apiRequestFailedMessage ? (
						<span
							className="codicon codicon-error"
							style={{ color: errorColor, marginBottom: "-1.5px" }}></span>
					) : (
						<ProgressIndicator />
					),
					cost != null ? (
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
					<span style={{ color: normalColor, fontWeight: "bold" }}>Claude has a question:</span>,
				]
			default:
				return [null, null]
		}
	}, [type, cost, apiRequestFailedMessage, isCommandExecuting])

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
			return JSON.parse(message.text || "{}") as ClaudeSayTool
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
				return (
					<>
						<div style={headerStyle}>
							{toolIcon("edit")}
							<span style={{ fontWeight: "bold" }}>Claude wants to edit this file:</span>
						</div>
						<CodeAccordian
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
							<span style={{ fontWeight: "bold" }}>Claude wants to create a new file:</span>
						</div>
						<CodeAccordian
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
								{message.type === "ask" ? "Claude wants to read this file:" : "Claude read this file:"}
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
			case "listFilesTopLevel":
				return (
					<>
						<div style={headerStyle}>
							{toolIcon("folder-opened")}
							<span style={{ fontWeight: "bold" }}>
								{message.type === "ask"
									? "Claude wants to view the top level files in this directory:"
									: "Claude viewed the top level files in this directory:"}
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
									? "Claude wants to recursively view all files in this directory:"
									: "Claude recursively viewed all files in this directory:"}
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
									? "Claude wants to view source code definition names used in this directory:"
									: "Claude viewed source code definition names used in this directory:"}
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
										Claude wants to search this directory for <code>{tool.regex}</code>:
									</>
								) : (
									<>
										Claude searched this directory for <code>{tool.regex}</code>:
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
									marginBottom: cost == null && apiRequestFailedMessage ? 10 : 0,
									justifyContent: "space-between",
									cursor: "pointer",
									userSelect: "none",
									WebkitUserSelect: "none",
									MozUserSelect: "none",
									msUserSelect: "none",
								}}
								onClick={onToggleExpand}>
								<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
									{icon}
									{title}
									{cost != null && cost > 0 && <VSCodeBadge>${Number(cost)?.toFixed(4)}</VSCodeBadge>}
								</div>
								<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></span>
							</div>
							{cost == null && apiRequestFailedMessage && (
								<>
									<p style={{ ...pStyle, color: "var(--vscode-errorForeground)" }}>
										{apiRequestFailedMessage}
									</p>
									{/* {apiProvider === "kodu" && (
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
													Uh-oh, this could be a problem on Kodu's end. We've been alerted and
													will resolve this ASAP. You can also{" "}
													<a
														href="https://discord.gg/claudedev"
														style={{ color: "inherit", textDecoration: "underline" }}>
														contact us on discord
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
							<Markdown markdown={message.text} />
						</div>
					)
				case "user_feedback":
					return (
						<div
							style={{
								backgroundColor: "var(--vscode-badge-background)",
								color: "var(--vscode-badge-foreground)",
								borderRadius: "3px",
								padding: "8px",
								whiteSpace: "pre-line",
								wordWrap: "break-word",
							}}>
							<span style={{ display: "block" }}>{message.text}</span>
							{message.images && message.images.length > 0 && (
								<Thumbnails images={message.images} style={{ marginTop: "8px" }} />
							)}
						</div>
					)
				case "user_feedback_diff":
					const tool = JSON.parse(message.text || "{}") as ClaudeSayTool
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
							<div style={{ color: "var(--vscode-charts-green)" }}>
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
									Claude won't be able to view the command's output. Please update VSCode (CMD/CTRL +
									Shift + P → Update) and make sure you're using a supported shell: bash, zsh, fish,
									or PowerShell.
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
							<div>
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
												className={`codicon codicon-chevron-${
													isExpanded ? "down" : "right"
												}`}></span>
											<span style={{ fontSize: "0.8em" }}>Command Output</span>
										</div>
										{isExpanded && <CodeBlock source={`${"```"}shell\n${output}\n${"```"}`} />}
									</div>
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
								<div style={{ color: "var(--vscode-charts-green)" }}>
									<Markdown markdown={message.text} />
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
							<div>
								<Markdown markdown={message.text} />
							</div>
						</>
					)
				default:
					return null
			}
	}
}

const ProgressIndicator = () => (
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
	// react-markdown lets us customize elements, so here we're using their example of replacing code blocks with SyntaxHighlighter. However when there are no language matches (` or ``` without a language specifier) then we default to a normal code element for inline code. Code blocks without a language specifier shouldn't be a common occurrence as we prompt Claude to always use a language specifier.
	// when claude wraps text in thinking tags, he doesnt use line breaks so we need to insert those ourselves to render markdown correctly
	const parsed = markdown?.replace(/<thinking>([\s\S]*?)<\/thinking>/g, (match, content) => {
		return content
		// return `_<thinking>_\n\n${content}\n\n_</thinking>_`
	})
	return (
		<div style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
			<ReactMarkdown
				children={parsed}
				components={{
					p(props) {
						const { style, ...rest } = props
						return (
							<p
								style={{
									...style,
									margin: 0,
									marginTop: 0,
									marginBottom: 0,
									whiteSpace: "pre-wrap",
									wordBreak: "break-word",
									overflowWrap: "anywhere",
								}}
								{...rest}
							/>
						)
					},
					ol(props) {
						const { style, ...rest } = props
						return (
							<ol
								style={{
									...style,
									padding: "0 0 0 20px",
									margin: "10px 0",
									wordBreak: "break-word",
									overflowWrap: "anywhere",
								}}
								{...rest}
							/>
						)
					},
					ul(props) {
						const { style, ...rest } = props
						return (
							<ul
								style={{
									...style,
									padding: "0 0 0 20px",
									margin: "10px 0",
									wordBreak: "break-word",
									overflowWrap: "anywhere",
								}}
								{...rest}
							/>
						)
					},
					// https://github.com/remarkjs/react-markdown?tab=readme-ov-file#use-custom-components-syntax-highlight
					code(props) {
						const { children, className, node, ...rest } = props
						const match = /language-(\w+)/.exec(className || "")
						return match ? (
							<div
								style={{
									borderRadius: 3,
									border: "1px solid var(--vscode-editorGroup-border)",
									overflow: "hidden",
								}}>
								<CodeBlock
									source={`${"```"}${match[1]}\n${String(children).replace(/\n$/, "")}\n${"```"}`}
								/>
							</div>
						) : (
							<code
								{...rest}
								className={className}
								style={{
									whiteSpace: "pre-line",
									wordBreak: "break-word",
									overflowWrap: "anywhere",
									backgroundColor: "var(--vscode-textCodeBlock-background)",
									color: "var(--vscode-textPreformat-foreground)",
									fontFamily: "var(--vscode-editor-font-family)",
									fontSize: "var(--vscode-editor-font-size)",
									borderRadius: "3px",
									border: "1px solid var(--vscode-textSeparator-foreground)",
									// padding: "2px 4px",
								}}>
								{children}
							</code>
						)
					},
				}}
			/>
		</div>
	)
})

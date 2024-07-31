import { ClaudeAsk, ClaudeMessage, ClaudeSay, ClaudeSayTool } from "@shared/ExtensionMessage"
import { VSCodeBadge, VSCodeButton, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import { COMMAND_OUTPUT_STRING } from "../utilities/combineCommandSequences"
import { SyntaxHighlighterStyle } from "../utilities/getSyntaxHighlighterStyleFromTheme"
import CodeBlock from "./CodeBlock/CodeBlock"
import Markdown from "react-markdown"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"

interface ChatRowProps {
	message: ClaudeMessage
	syntaxHighlighterStyle: SyntaxHighlighterStyle
	isExpanded: boolean
	onToggleExpand: () => void
	lastModifiedMessage?: ClaudeMessage
	isLast: boolean
}

const ChatRow: React.FC<ChatRowProps> = ({
	message,
	syntaxHighlighterStyle,
	isExpanded,
	onToggleExpand,
	lastModifiedMessage,
	isLast,
}) => {
	const cost = message.text != null && message.say === "api_req_started" ? JSON.parse(message.text).cost : undefined
	const apiRequestFailedMessage =
		isLast && lastModifiedMessage?.ask === "api_req_failed" // if request is retried then the latest message is a api_req_retried
			? lastModifiedMessage?.text
			: undefined
	const isCommandExecuting =
		isLast && lastModifiedMessage?.ask === "command" && lastModifiedMessage?.text?.includes(COMMAND_OUTPUT_STRING)

	const getIconAndTitle = (type: ClaudeAsk | ClaudeSay | undefined): [JSX.Element | null, JSX.Element | null] => {
		const normalColor = "var(--vscode-foreground)"
		const errorColor = "var(--vscode-errorForeground)"
		const successColor = "var(--vscode-testing-iconPassed)"

		const ProgressIndicator = (
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

		switch (type) {
			case "request_limit_reached":
				return [
					<span
						className="codicon codicon-error"
						style={{ color: errorColor, marginBottom: "-1.5px" }}></span>,
					<span style={{ color: errorColor, fontWeight: "bold" }}>Max Requests Reached</span>,
				]
			case "error":
				return [
					<span
						className="codicon codicon-error"
						style={{ color: errorColor, marginBottom: "-1.5px" }}></span>,
					<span style={{ color: errorColor, fontWeight: "bold" }}>Error</span>,
				]
			case "command":
				return [
					isCommandExecuting ? (
						ProgressIndicator
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
					cost ? (
						<span
							className="codicon codicon-check"
							style={{ color: successColor, marginBottom: "-1.5px" }}></span>
					) : apiRequestFailedMessage ? (
						<span
							className="codicon codicon-error"
							style={{ color: errorColor, marginBottom: "-1.5px" }}></span>
					) : (
						ProgressIndicator
					),
					cost ? (
						<span style={{ color: normalColor, fontWeight: "bold" }}>API Request Complete</span>
					) : apiRequestFailedMessage ? (
						<span style={{ color: errorColor, fontWeight: "bold" }}>API Request Failed</span>
					) : (
						<span style={{ color: normalColor, fontWeight: "bold" }}>Making API Request...</span>
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
	}

	const renderMarkdown = (markdown: string = "") => {
		// react-markdown lets us customize elements, so here we're using their example of replacing code blocks with SyntaxHighlighter. However when there are no language matches (` or ``` without a language specifier) then we default to a normal code element for inline code. Code blocks without a language specifier shouldn't be a common occurrence as we prompt Claude to always use a language specifier.
		return (
			<div style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
				<Markdown
					children={markdown}
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
								<SyntaxHighlighter
									{...(rest as any)} // will be passed down to pre
									PreTag="div"
									children={String(children).replace(/\n$/, "")}
									language={match[1]}
									style={{
										...syntaxHighlighterStyle,
										'code[class*="language-"]': {
											background: "var(--vscode-editor-background)",
										},
										'pre[class*="language-"]': {
											background: "var(--vscode-editor-background)",
										},
									}}
									customStyle={{
										overflowX: "auto",
										overflowY: "hidden",
										maxWidth: "100%",
										margin: 0,
										padding: "10px",
										// important to note that min-width: max-content is not required here how it is in CodeBlock.tsx
										borderRadius: 3,
										border: "1px solid var(--vscode-sideBar-border)",
										fontSize: "var(--vscode-editor-font-size)",
										lineHeight: "var(--vscode-editor-line-height)",
										fontFamily: "var(--vscode-editor-font-family)",
									}}
								/>
							) : (
								<code
									{...rest}
									className={className}
									style={{
										whiteSpace: "pre-line",
										wordBreak: "break-word",
										overflowWrap: "anywhere",
									}}>
									{children}
								</code>
							)
						},
					}}
				/>
			</div>
		)
	}

	const renderContent = () => {
		const [icon, title] = getIconAndTitle(message.type === "ask" ? message.ask : message.say)

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
									}}>
									<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
										{icon}
										{title}
										{cost && <VSCodeBadge>${Number(cost).toFixed(4)}</VSCodeBadge>}
									</div>
									<VSCodeButton
										appearance="icon"
										aria-label="Toggle Details"
										onClick={onToggleExpand}>
										<span
											className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></span>
									</VSCodeButton>
								</div>
								{cost == null && apiRequestFailedMessage && (
									<p style={{ ...pStyle, color: "var(--vscode-errorForeground)" }}>
										{apiRequestFailedMessage}
									</p>
								)}
							</>
						)
					case "api_req_finished":
						return null // we should never see this message type
					case "text":
						return <div>{renderMarkdown(message.text)}</div>
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
								<span>{message.text}</span>
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
								<div style={{ color: "var(--vscode-testing-iconPassed)" }}>
									{renderMarkdown(message.text)}
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
								<div>{renderMarkdown(message.text)}</div>
							</>
						)
				}
			case "ask":
				switch (message.ask) {
					case "tool":
						const tool = JSON.parse(message.text || "{}") as ClaudeSayTool
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
										<CodeBlock
											diff={tool.diff!}
											path={tool.path!}
											syntaxHighlighterStyle={syntaxHighlighterStyle}
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
											<span style={{ fontWeight: "bold" }}>
												Claude wants to create a new file:
											</span>
										</div>
										<CodeBlock
											code={tool.content!}
											path={tool.path!}
											syntaxHighlighterStyle={syntaxHighlighterStyle}
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
											<span style={{ fontWeight: "bold" }}>Claude wants to read this file:</span>
										</div>
										<CodeBlock
											code={tool.content!}
											path={tool.path!}
											syntaxHighlighterStyle={syntaxHighlighterStyle}
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
												Claude wants to view the top level files in this directory:
											</span>
										</div>
										<CodeBlock
											code={tool.content!}
											path={tool.path!}
											language="shell-session"
											syntaxHighlighterStyle={syntaxHighlighterStyle}
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
												Claude wants to recursively view all files in this directory:
											</span>
										</div>
										<CodeBlock
											code={tool.content!}
											path={tool.path!}
											language="shell-session"
											syntaxHighlighterStyle={syntaxHighlighterStyle}
											isExpanded={isExpanded}
											onToggleExpand={onToggleExpand}
										/>
									</>
								)
							case "viewSourceCodeDefinitionsTopLevel":
								return (
									<>
										<div style={headerStyle}>
											{toolIcon("file-code")}
											<span style={{ fontWeight: "bold" }}>
												Claude wants to view source code definitions in files at the top level
												of this directory:
											</span>
										</div>
										<CodeBlock
											code={tool.content!}
											path={tool.path!}
											syntaxHighlighterStyle={syntaxHighlighterStyle}
											isExpanded={isExpanded}
											onToggleExpand={onToggleExpand}
										/>
									</>
								)
						}
						break
					case "request_limit_reached":
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
								output: text.slice(outputIndex + COMMAND_OUTPUT_STRING.length).trim(),
							}
						}

						const { command, output } = splitMessage(message.text || "")
						return (
							<>
								<div style={headerStyle}>
									{icon}
									{title}
								</div>
								<div>
									<div>
										<CodeBlock
											code={command}
											language="shell-session"
											syntaxHighlighterStyle={syntaxHighlighterStyle}
											isExpanded={isExpanded}
											onToggleExpand={onToggleExpand}
										/>
									</div>

									{output && (
										<>
											<p style={{ ...pStyle, margin: "10px 0 10px 0" }}>
												{COMMAND_OUTPUT_STRING}
											</p>
											<CodeBlock
												code={output}
												language="shell-session"
												syntaxHighlighterStyle={syntaxHighlighterStyle}
												isExpanded={isExpanded}
												onToggleExpand={onToggleExpand}
											/>
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
									<div style={{ color: "var(--vscode-testing-iconPassed)" }}>
										{renderMarkdown(message.text)}
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
								<div>{renderMarkdown(message.text)}</div>
							</>
						)
				}
		}
	}

	// NOTE: we cannot return null as virtuoso does not support it, so we must use a separate visibleMessages array to filter out messages that should not be rendered

	return (
		<div
			style={{
				padding: "10px 6px 10px 15px",
			}}>
			{renderContent()}
			{isExpanded && message.say === "api_req_started" && (
				<div style={{ marginTop: "10px" }}>
					<CodeBlock
						code={JSON.stringify(JSON.parse(message.text || "{}").request, null, 2)}
						language="json"
						syntaxHighlighterStyle={syntaxHighlighterStyle}
						isExpanded={true}
						onToggleExpand={onToggleExpand}
					/>
				</div>
			)}
		</div>
	)
}

export default ChatRow

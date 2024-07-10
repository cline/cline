import React, { useState } from "react"
import { ClaudeMessage, ClaudeAsk, ClaudeSay, ClaudeSayTool } from "@shared/ExtensionMessage"
import { VSCodeButton, VSCodeProgressRing, VSCodeBadge } from "@vscode/webview-ui-toolkit/react"
import { COMMAND_OUTPUT_STRING } from "../utilities/combineCommandSequences"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { dark } from "react-syntax-highlighter/dist/esm/styles/prism"
import CodeBlock from "./CodeBlock"

interface ChatRowProps {
	message: ClaudeMessage
}

const ChatRow: React.FC<ChatRowProps> = ({ message }) => {
	const [isExpanded, setIsExpanded] = useState(false)
	const cost = message.text != null && message.say === "api_req_started" ? JSON.parse(message.text).cost : undefined

	const getIconAndTitle = (type: ClaudeAsk | ClaudeSay | undefined): [JSX.Element | null, JSX.Element | null] => {
		const normalColor = "var(--vscode-foreground)"
		const errorColor = "var(--vscode-errorForeground)"
		const successColor = "var(--vscode-testing-iconPassed)"

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
					<span
						className="codicon codicon-terminal"
						style={{ color: normalColor, marginBottom: "-1.5px" }}></span>,
					<span style={{ color: normalColor, fontWeight: "bold" }}>Claude wants to execute this command:</span>,
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
					) : (
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
					),
					<span style={{ color: normalColor, fontWeight: "bold" }}>
						{cost ? "API Request Complete" : "Making API Request..."}
					</span>,
				]
			default:
				return [null, null]
		}
	}

	const renderContent = () => {
		const [icon, title] = getIconAndTitle(message.type === "ask" ? message.ask : message.say)

		const headerStyle: React.CSSProperties = {
			display: "flex",
			alignItems: "center",
			gap: "10px",
			marginBottom: "10px",
		}

		const contentStyle: React.CSSProperties = {
			margin: 0,
			whiteSpace: "pre-line",
		}

		switch (message.type) {
			case "say":
				switch (message.say) {
					case "api_req_started":
						return (
							<div style={{ ...headerStyle, marginBottom: 0, justifyContent: "space-between" }}>
								<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
									{icon}
									{title}
									{cost && <VSCodeBadge>${Number(cost).toFixed(4)}</VSCodeBadge>}
								</div>
								<VSCodeButton
									appearance="icon"
									aria-label="Toggle Details"
									onClick={() => setIsExpanded(!isExpanded)}>
									<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></span>
								</VSCodeButton>
							</div>
						)
					case "api_req_finished":
						return null // Hide this message type
					case "text":
						return <p style={contentStyle}>{message.text}</p>
					case "error":
						return (
							<>
								{title && (
									<div style={headerStyle}>
										{icon}
										{title}
									</div>
								)}
								<p style={{ ...contentStyle, color: "var(--vscode-errorForeground)" }}>
									{message.text}
								</p>
							</>
						)
					case "completion_result":
						return (
							<>
								<div style={headerStyle}>
									{icon}
									{title}
								</div>
								<p style={{ ...contentStyle, color: "var(--vscode-testing-iconPassed)" }}>
									{message.text}
								</p>
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
								<p style={contentStyle}>{message.text}</p>
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
										<CodeBlock diff={tool.diff!} path={tool.path!} />
									</>
								)
							case "newFileCreated":
								return (
									<>
										<div style={headerStyle}>
											{toolIcon("new-file")}
											<span style={{ fontWeight: "bold" }}>Claude wants to create a new file:</span>
										</div>
										<CodeBlock code={tool.content!} path={tool.path!} />
									</>
								)
							case "readFile":
								return (
									<>
										<div style={headerStyle}>
											{toolIcon("file-code")}
											<span style={{ fontWeight: "bold" }}>Claude wants to read this file:</span>
										</div>
										<CodeBlock code={tool.content!} path={tool.path!} />
									</>
								)
							case "listFiles":
								return (
									<>
										<div style={headerStyle}>
											{toolIcon("folder-opened")}
											<span style={{ fontWeight: "bold" }}>Claude wants to view this directory:</span>
										</div>
										<CodeBlock code={tool.content!} path={tool.path!} language="shell-session" />
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
								<p style={{ ...contentStyle, color: "var(--vscode-errorForeground)" }}>
									{message.text}
								</p>
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
								<div style={contentStyle}>
									<div>
										<CodeBlock code={command} language="shell-session" />
									</div>

									{output && (
										<>
											<p style={{ ...contentStyle, margin: "10px 0 10px 0" }}>
												{COMMAND_OUTPUT_STRING}
											</p>
											<CodeBlock
												code={output}
												language="shell-session"
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
									<p style={{ ...contentStyle, color: "var(--vscode-testing-iconPassed)" }}>
										{message.text}
									</p>
								</div>
							)
						} else {
							return null // Don't render anything when we get a completion_result ask without text
						}
					default:
						return (
							<>
								{title && (
									<div style={headerStyle}>
										{icon}
										{title}
									</div>
								)}
								<p style={contentStyle}>{message.text}</p>
							</>
						)
				}
		}
	}

	// we need to return null here instead of in getContent since that way would result in padding being applied
	if (message.say === "api_req_finished") {
		return null // Don't render anything for this message type
	}

	if (message.type === "ask" && message.ask === "completion_result" && message.text === "") {
		return null // Don't render anything for this message type
	}

	return (
		<div
			style={{
				padding: "10px 20px 10px 20px",
			}}>
			{renderContent()}
			{isExpanded && message.say === "api_req_started" && (
				<div style={{ marginTop: "10px" }}>
					<CodeBlock code={JSON.stringify(JSON.parse(message.text || "{}").request, null, 2)} language="json" />
				</div>
			)}
		</div>
	)
}

export default ChatRow

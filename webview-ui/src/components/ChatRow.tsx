import React, { useState } from "react"
import { ClaudeMessage, ClaudeAsk, ClaudeSay } from "@shared/ExtensionMessage"
import { VSCodeButton, VSCodeProgressRing, VSCodeTag } from "@vscode/webview-ui-toolkit/react"

interface ChatRowProps {
	message: ClaudeMessage
	cost?: string
}

const ChatRow: React.FC<ChatRowProps> = ({ message, cost }) => {
	const [isExpanded, setIsExpanded] = useState(false)

	const getIconAndTitle = (type: ClaudeAsk | ClaudeSay | undefined): [JSX.Element | null, string | null] => {
		switch (type) {
			case "request_limit_reached":
				return [
					<span className="codicon codicon-error" style={{ color: "var(--vscode-errorForeground)" }}></span>,
					"Max Requests Reached",
				]
			case "error":
				return [
					<span className="codicon codicon-error" style={{ color: "var(--vscode-errorForeground)" }}></span>,
					"Error",
				]
			case "command":
				return [<span className="codicon codicon-terminal"></span>, "Command"]
			case "completion_result":
				return [
					<span
						className="codicon codicon-check"
						style={{ color: "var(--vscode-testing-iconPassed)" }}></span>,
					"Task Completed",
				]
			case "tool":
				return [<span className="codicon codicon-tools"></span>, "Tool"]
			default:
				return [null, null]
		}
	}

	const renderContent = () => {
		const [icon, title] = getIconAndTitle(message.type === "ask" ? message.ask : message.say)

		const headerStyle: React.CSSProperties = {
			display: "flex",
			alignItems: "center",
			justifyContent: "left",
			gap: "10px",
			marginBottom: "10px",
		}

		const contentStyle: React.CSSProperties = {
			marginLeft: "20px",
		}

		switch (message.type) {
			case "say":
				switch (message.say) {
					case "task":
						return (
							<div
								style={{
									backgroundColor: "var(--vscode-textBlockQuote-background)",
									padding: "10px",
									borderLeft: "5px solid var(--vscode-textBlockQuote-border)",
								}}>
								<h3 style={headerStyle}>Task</h3>
								<p style={contentStyle}>{message.text}</p>
							</div>
						)
					case "api_req_started":
						return (
							<div>
								<div style={headerStyle}>
									<span>Made API request...</span>
									{cost ? (
										<span
											className="codicon codicon-check"
											style={{ color: "var(--vscode-testing-iconPassed)" }}></span>
									) : (
										<VSCodeProgressRing />
									)}
									{cost && <VSCodeTag>{cost}</VSCodeTag>}
									<VSCodeButton
										appearance="icon"
										aria-label="Toggle Details"
										onClick={() => setIsExpanded(!isExpanded)}>
										<span
											className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></span>
									</VSCodeButton>
								</div>
							</div>
						)
					case "api_req_finished":
						return null // Hide this message type
					case "tool":
					case "error":
					case "text":
					case "command_output":
						return (
							<>
								{title && (
									<div style={headerStyle}>
										{icon}
										<h4>{title}</h4>
									</div>
								)}
								<pre style={contentStyle}>
									<code>{message.text}</code>
								</pre>
							</>
						)
					case "completion_result":
						return (
							<div
								style={{
									borderLeft: "5px solid var(--vscode-testing-iconPassed)",
									paddingLeft: "10px",
								}}>
								<div style={headerStyle}>
									{icon}
									<h4 style={{ color: "var(--vscode-testing-iconPassed)" }}>{title}</h4>
								</div>
								<p style={contentStyle}>{message.text}</p>
							</div>
						)
					default:
						return (
							<>
								{title && (
									<div style={headerStyle}>
										{icon}
										<h4>{title}</h4>
									</div>
								)}
								<p style={contentStyle}>{message.text}</p>
							</>
						)
				}
			case "ask":
				switch (message.ask) {
					case "request_limit_reached":
						return (
							<>
								<div style={headerStyle}>
									{icon}
									<h4>{title}</h4>
								</div>
								<p style={{ ...contentStyle, color: "var(--vscode-errorForeground)" }}>
									Your task has reached the maximum request limit (maxRequestsPerTask, you can change
									this in settings). Do you want to keep going or start a new task?
								</p>
							</>
						)
					case "command":
						return (
							<>
								<div style={headerStyle}>
									{icon}
									<h4>{title}</h4>
								</div>
								<div style={contentStyle}>
									<p>Claude would like to run this command. Do you allow this?</p>
									<pre>
										<code>{message.text}</code>
									</pre>
								</div>
							</>
						)
					case "completion_result":
						if (message.text) {
							return (
								<div
									style={{
										borderLeft: "5px solid var(--vscode-testing-iconPassed)",
										paddingLeft: "10px",
									}}>
									<div style={headerStyle}>
										{icon}
										<h4 style={{ color: "var(--vscode-testing-iconPassed)" }}>{title}</h4>
									</div>
									<p style={contentStyle}>{message.text}</p>
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
										<h4>{title}</h4>
									</div>
								)}
								<p style={contentStyle}>{message.text}</p>
							</>
						)
				}
		}
	}

	if (message.say === "api_req_finished") {
		return null // Don't render anything for this message type
	}

	return (
		<div
			style={{
				padding: "10px",
				borderBottom: "1px solid var(--vscode-panel-border)",
				backgroundColor:
					message.say === "task"
						? "var(--vscode-textBlockQuote-background)"
						: "var(--vscode-editor-background)",
			}}>
			{renderContent()}
			{isExpanded && message.say === "api_req_started" && (
				<pre style={{ marginTop: "10px" }}>
					<code>{message.text}</code>
				</pre>
			)}
		</div>
	)
}

export default ChatRow

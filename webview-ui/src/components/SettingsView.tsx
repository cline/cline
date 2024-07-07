import React from "react"
import { VSCodeTextField, VSCodeDivider, VSCodeLink, VSCodeButton } from "@vscode/webview-ui-toolkit/react"

const SettingsView = () => {
	const handleDoneClick = () => {
		// Add your logic here for what should happen when the Done button is clicked
		console.log("Done button clicked")
	}

	return (
		<div style={{ margin: "0 auto", paddingTop: "10px" }}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: "20px",
				}}>
				<h2 style={{ color: "var(--vscode-foreground)", margin: 0 }}>Settings</h2>
				<VSCodeButton onClick={handleDoneClick}>Done</VSCodeButton>
			</div>

			<div style={{ marginBottom: "20px" }}>
				<VSCodeTextField style={{ width: "100%" }} placeholder="Enter your Anthropic API Key">
					Anthropic API Key
				</VSCodeTextField>
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					This key is not shared with anyone and only used to make API requests from the extension.
					<VSCodeLink href="https://console.anthropic.com/" style={{ display: "inline" }}>
						You can get an API key by signing up here.
					</VSCodeLink>
				</p>
			</div>

			<div style={{ marginBottom: "20px" }}>
				<VSCodeTextField style={{ width: "100%" }} placeholder="Enter maximum number of requests">
					Maximum # Requests Per Task
				</VSCodeTextField>
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					If Claude Dev reaches this limit, it will pause and ask for your permission before making additional
					requests.
				</p>
			</div>

			<VSCodeDivider />

			<div
				style={{
					marginTop: "20px",
					textAlign: "center",
					color: "var(--vscode-descriptionForeground)",
					fontSize: "12px",
					lineHeight: "1.5",
                    fontStyle: "italic"
				}}>
				<p>Made possible by the latest breakthroughs in Claude 3.5 Sonnet's agentic coding capabilities.</p>
				<p>
					This project was submitted to Anthropic's "Build with Claude June 2024 contest".
					<VSCodeLink href="https://github.com/saoudrizwan/claude-dev">
						github.com/saoudrizwan/claude-dev
					</VSCodeLink>
				</p>
			</div>
		</div>
	)
}

export default SettingsView

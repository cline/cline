import React, { useState, useEffect } from "react"
import { VSCodeButton, VSCodeTextField, VSCodeLink, VSCodeDivider } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "../utilities/vscode"

interface WelcomeViewProps {
	apiKey: string
	setApiKey: React.Dispatch<React.SetStateAction<string>>
}

const WelcomeView: React.FC<WelcomeViewProps> = ({ apiKey, setApiKey }) => {
	const [apiKeyErrorMessage, setApiKeyErrorMessage] = useState<string | undefined>(undefined)

	const disableLetsGoButton = apiKeyErrorMessage != null

	const handleApiKeyChange = (event: any) => {
		const input = event.target.value
		setApiKey(input)
		validateApiKey(input)
	}

	const validateApiKey = (value: string) => {
		if (value.trim() === "") {
			setApiKeyErrorMessage("API Key cannot be empty")
		} else {
			setApiKeyErrorMessage(undefined)
		}
	}

	const handleSubmit = () => {
		vscode.postMessage({ type: "apiKey", text: apiKey })
	}

    useEffect(() => {
		validateApiKey(apiKey)
	}, [])

	return (
		<div style={{ maxWidth: "600px", margin: "0 auto", padding: "20px" }}>
			<h1 style={{ color: "var(--vscode-foreground)" }}>Hi, I'm Claude Dev</h1>
			<p>
				I can do all kinds of tasks thanks to the latest breakthroughs in Claude Sonnet 3.5's agentic coding
				capabilities. I am prompted to think through tasks step-by-step and have access to tools that let me get
				information about your project, read & write code, and execute terminal commands (with your permission,
				of course).
			</p>

			<h3>Here are some cool things I can do:</h3>
			<ul>
				<li>Create new projects from scratch based on your requirements</li>
				<li>Debug and fix code issues in your existing projects</li>
				<li>Refactor and optimize your codebase</li>
				<li>Analyze your system's performance and suggest improvements</li>
				<li>Generate documentation for your code</li>
				<li>Set up and configure development environments</li>
				<li>Perform code reviews and suggest best practices</li>
			</ul>

			<h3>To get started, this extension needs an Anthropic API key:</h3>
			<ol>
				<li>
					Go to{" "}
					<VSCodeLink href="https://console.anthropic.com/" style={{ display: "inline" }}>
						https://console.anthropic.com/
					</VSCodeLink>
				</li>
				<li>You may need to buy some credits (although Anthropic is offering $5 free credit for new users)</li>
				<li>Click 'Get API Keys' and create a new key for me (you can delete it any time)</li>
			</ol>

			<VSCodeDivider />

			<div style={{ marginTop: "20px", display: "flex", alignItems: "center" }}>
				<VSCodeTextField
					style={{ flexGrow: 1, marginRight: "10px" }}
					placeholder="Enter your Anthropic API Key"
					value={apiKey}
					onInput={handleApiKeyChange}
				/>
				<VSCodeButton onClick={handleSubmit} disabled={disableLetsGoButton}>
					Let's go!
				</VSCodeButton>
			</div>

			<p style={{ fontSize: "12px", marginTop: "10px", color: "var(--vscode-descriptionForeground)" }}>
				Your API key is stored securely on your computer and used only for interacting with the Anthropic API.
			</p>
		</div>
	)
}

export default WelcomeView

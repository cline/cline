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
	}, [apiKey])

	return (
		<div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, padding: "0 20px" }}>
			<h2>Hi, I'm Claude Dev</h2>
			<p>
				I can do all kinds of tasks thanks to the latest breakthroughs in{" "}
				<VSCodeLink
					href="https://www-cdn.anthropic.com/fed9cc193a14b84131812372d8d5857f8f304c52/Model_Card_Claude_3_Addendum.pdf"
					style={{ display: "inline" }}>
					Claude 3.5 Sonnet's agentic coding capabilities.
				</VSCodeLink>{" "}
				I am prompted to think through tasks step-by-step and have access to tools that let me read & write
				files, analyze project source code, and execute terminal commands (with your permission, of course).
			</p>

			<b>To get started, this extension needs an Anthropic API key:</b>
			<ol style={{ paddingLeft: "15px" }}>
				<li>
					Go to{" "}
					<VSCodeLink href="https://console.anthropic.com" style={{ display: "inline" }}>
						https://console.anthropic.com
					</VSCodeLink>
				</li>
				<li>You may need to buy some credits (although Anthropic is offering $5 free credit for new users)</li>
				<li>Click 'Get API Keys' and create a new key (you can delete it any time)</li>
			</ol>

			<VSCodeDivider />

			<div style={{ marginTop: "20px", display: "flex", alignItems: "center" }}>
				<VSCodeTextField
					style={{ flexGrow: 1, marginRight: "10px" }}
					placeholder="Enter API Key..."
					value={apiKey}
					onInput={(e: any) => setApiKey(e.target.value)}
				/>
				<VSCodeButton onClick={handleSubmit} disabled={disableLetsGoButton}>
					Submit
				</VSCodeButton>
			</div>

			<p style={{ fontSize: "12px", marginTop: "10px", color: "var(--vscode-descriptionForeground)" }}>
				Your API key is stored securely on your computer and used only for interacting with the Anthropic API.
			</p>
		</div>
	)
}

export default WelcomeView

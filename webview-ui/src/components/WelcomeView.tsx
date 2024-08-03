import { ApiConfiguration } from "@shared/api"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useState } from "react"
import { validateApiConfiguration } from "../utils/validate"
import { vscode } from "../utils/vscode"
import ApiOptions from "./ApiOptions"

interface WelcomeViewProps {
	apiConfiguration?: ApiConfiguration
	setApiConfiguration: React.Dispatch<React.SetStateAction<ApiConfiguration | undefined>>
}

const WelcomeView: React.FC<WelcomeViewProps> = ({ apiConfiguration, setApiConfiguration }) => {
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)

	const disableLetsGoButton = apiErrorMessage != null

	const handleSubmit = () => {
		vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
	}

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(apiConfiguration))
	}, [apiConfiguration])

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

			<b>To get started, this extension needs an API key for Claude 3.5 Sonnet:</b>

			<div style={{ marginTop: "15px" }}>
				<ApiOptions apiConfiguration={apiConfiguration} setApiConfiguration={setApiConfiguration} />
				<VSCodeButton onClick={handleSubmit} disabled={disableLetsGoButton} style={{ marginTop: "3px" }}>
					Let's go!
				</VSCodeButton>
			</div>
		</div>
	)
}

export default WelcomeView

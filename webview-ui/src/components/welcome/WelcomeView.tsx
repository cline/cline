import { VSCodeButton, VSCodeDivider, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { validateApiConfiguration } from "../../utils/validate"
import { vscode } from "../../utils/vscode"
import ApiOptions from "../settings/ApiOptions"

const WelcomeView = () => {
	const { apiConfiguration } = useExtensionState()
	const [showApiOptions, setShowApiOptions] = useState(false)
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)

	const disableLetsGoButton = apiErrorMessage != null

	const handleLogin = () => {
		vscode.postMessage({ type: "accountLoginClicked" })
	}

	const handleSubmit = () => {
		vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
	}

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(apiConfiguration))
	}, [apiConfiguration])

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				padding: "0 20px",
				display: "flex",
				flexDirection: "column",
			}}>
			<h2>Hi, I'm Cline</h2>
			<p>
				I can do all kinds of tasks thanks to the latest breakthroughs in{" "}
				<VSCodeLink
					href="https://www-cdn.anthropic.com/fed9cc193a14b84131812372d8d5857f8f304c52/Model_Card_Claude_3_Addendum.pdf"
					style={{ display: "inline" }}>
					Claude 3.5 Sonnet's agentic coding capabilities
				</VSCodeLink>{" "}
				and access to tools that let me create & edit files, explore complex projects, use the browser, and execute
				terminal commands (with your permission, of course). I can even use MCP to create new tools and extend my own
				capabilities.
			</p>

			<div style={{ marginTop: "20px", marginBottom: "20px" }}>
				<VSCodeButton appearance="primary" onClick={handleLogin}>
					Log in to Cline
				</VSCodeButton>

				<div style={{ marginTop: "10px" }}>
					<ul style={{ paddingLeft: "20px", margin: "10px 0" }}>
						<li>Get $5 worth of free tokens</li>
						<li>No processing fees</li>
						<li>Seamless integration</li>
					</ul>
				</div>
			</div>

			<VSCodeDivider />

			<div style={{ marginTop: "20px" }}>
				<VSCodeButton appearance="secondary" onClick={() => setShowApiOptions(!showApiOptions)}>
					{showApiOptions ? "Hide API options" : "Use your own provider API key"}
				</VSCodeButton>

				{showApiOptions && (
					<div style={{ marginTop: "10px" }}>
						<ApiOptions showModelOptions={false} />
						<VSCodeButton onClick={handleSubmit} disabled={disableLetsGoButton} style={{ marginTop: "3px" }}>
							Let's go!
						</VSCodeButton>
					</div>
				)}
			</div>
		</div>
	)
}

export default WelcomeView

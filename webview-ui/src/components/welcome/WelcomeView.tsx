import { VSCodeButton, VSCodeDivider, VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useState } from "react"
import { useEvent } from "react-use"
import { ExtensionMessage } from "../../../../src/shared/ExtensionMessage"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { validateApiConfiguration } from "../../utils/validate"
import { vscode } from "../../utils/vscode"
import ApiOptions from "../settings/ApiOptions"

const WelcomeView = () => {
	const { apiConfiguration } = useExtensionState()
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
	const [showApiOptions, setShowApiOptions] = useState(false)

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
			<div
				style={{
					height: "100%",
					padding: "0 20px",
					overflow: "auto",
				}}>
				<h2>Hi, I'm Cline</h2>
				<p>
					I can do all kinds of tasks thanks to breakthroughs in Claude 3.7 Sonnet's agentic coding capabilities and
					access to tools that let me create & edit files, explore complex projects, use the browser, and execute
					terminal commands (with your permission, of course). I can even use MCP to create new tools and extend my own
					capabilities.
				</p>

				<div style={{ marginTop: "20px", marginBottom: "20px" }}>
					<VSCodeButton appearance="primary" onClick={handleLogin}>
						Sign Up with Cline
					</VSCodeButton>

					<div style={{ marginTop: "10px" }}>
						<ul style={{ paddingLeft: "20px", margin: "10px 0" }}>
							<li>Choose from hundreds of models like Claude 3.5 Sonnet and DeepSeek V3</li>
							<li>Get started for free with no credit card required</li>
						</ul>
					</div>
				</div>

				<VSCodeDivider />

				<div style={{ marginTop: "20px" }}>
					{!showApiOptions && (
						<VSCodeButton appearance="secondary" onClick={() => setShowApiOptions(!showApiOptions)}>
							Use your own API key
						</VSCodeButton>
					)}

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
		</div>
	)
}

export default WelcomeView

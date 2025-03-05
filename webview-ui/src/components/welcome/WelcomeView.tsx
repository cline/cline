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
				<div style={{ display: "flex", justifyContent: "center", margin: "20px 0" }}>
					<ClineLogo />
				</div>
				<p>
					I can do all kinds of tasks thanks to breakthroughs in{" "}
					<VSCodeLink href="https://www.anthropic.com/claude/sonnet" style={{ display: "inline" }}>
						Claude 3.7 Sonnet's
					</VSCodeLink>
					agentic coding capabilities and access to tools that let me create & edit files, explore complex projects, use
					a browser, and execute terminal commands <i>(with your permission, of course)</i>. I can even use MCP to
					create new tools and extend my own capabilities.
				</p>

				<p style={{ color: "var(--vscode-descriptionForeground)" }}>
					Sign up for an account to get started for free, or use an API key that provides access to models like Claude
					3.7 Sonnet.
				</p>

				<VSCodeButton appearance="primary" onClick={handleLogin} style={{ width: "100%" }}>
					Get Started for Free
				</VSCodeButton>

				{!showApiOptions && (
					<VSCodeButton
						appearance="secondary"
						onClick={() => setShowApiOptions(!showApiOptions)}
						style={{ marginTop: 10, width: "100%" }}>
						Use your own API key
					</VSCodeButton>
				)}

				<div style={{ marginTop: "18px" }}>
					{showApiOptions && (
						<div>
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

const ClineLogo: React.FC<{ style?: React.CSSProperties }> = ({ style }) => {
	// (can't use svgs in vsc extensions)
	const logoBase64 =
		"data:image/png;base64,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"

	return (
		<img
			src={logoBase64}
			style={{
				width: "57px",
				height: "60px",
				...style,
			}}
			alt="Cline Logo"
		/>
	)
}

export default WelcomeView

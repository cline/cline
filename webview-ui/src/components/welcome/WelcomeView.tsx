import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { validateApiConfiguration } from "../../utils/validate"
import { vscode } from "../../utils/vscode"
import ApiOptions from "../settings/ApiOptions"

const WelcomeView = () => {
	const { apiConfiguration } = useExtensionState()

	const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)

	const handleSubmit = () => {
		const error = validateApiConfiguration(apiConfiguration)
		if (error) {
			setErrorMessage(error)
			return
		}
		setErrorMessage(undefined)
		vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
	}

	return (
		<div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, padding: "0 20px" }}>
			<h2>Hi, I'm Roo!</h2>
			<p>
				I can do all kinds of tasks thanks to the latest breakthroughs in agentic coding capabilities and access
				to tools that let me create & edit files, explore complex projects, use the browser, and execute
				terminal commands (with your permission, of course). I can even use MCP to create new tools and extend
				my own capabilities.
			</p>

			<b>To get started, this extension needs an API provider.</b>

			<div style={{ marginTop: "10px" }}>
				<ApiOptions fromWelcomeView />
				<div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
					<VSCodeButton onClick={handleSubmit} style={{ marginTop: "3px" }}>
						Let's go!
					</VSCodeButton>
					{errorMessage && (
						<span
							style={{
								color: "var(--vscode-errorForeground)",
								fontSize: "12px",
							}}>
							{errorMessage}
						</span>
					)}
				</div>
			</div>
		</div>
	)
}

export default WelcomeView

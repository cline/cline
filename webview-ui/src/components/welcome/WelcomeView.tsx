import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { validateApiConfiguration } from "../../utils/validate"
import { vscode } from "../../utils/vscode"
import ApiOptions from "../settings/ApiOptions"

const WelcomeView = () => {
	const { apiConfiguration } = useExtensionState()

	const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)

	const handleSubmit = async () => {
		// Focus the active element's parent to trigger blur
		document.activeElement?.parentElement?.focus()

		// Small delay to let blur events complete
		await new Promise((resolve) => setTimeout(resolve, 50))

		const error = validateApiConfiguration(apiConfiguration)
		if (error) {
			setErrorMessage(error)
			return
		}
		setErrorMessage(undefined)
		vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
	}

	return (
		<div className="flex flex-col min-h-screen px-0 pb-5">
			<h2>Hi, I'm Roo!</h2>
			<p>
				I can do all kinds of tasks thanks to the latest breakthroughs in agentic coding capabilities and access
				to tools that let me create & edit files, explore complex projects, use the browser, and execute
				terminal commands (with your permission, of course). I can even use MCP to create new tools and extend
				my own capabilities.
			</p>

			<b>To get started, this extension needs an API provider.</b>

			<div className="mt-3">
				<ApiOptions fromWelcomeView />
			</div>

			<div className="sticky bottom-0 bg-[var(--vscode-editor-background)] py-3">
				<div className="flex flex-col gap-1.5">
					<VSCodeButton onClick={handleSubmit}>Let's go!</VSCodeButton>
					{errorMessage && <span className="text-destructive">{errorMessage}</span>}
				</div>
			</div>
		</div>
	)
}

export default WelcomeView

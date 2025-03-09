import { useCallback, useState } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

import { useExtensionState } from "../../context/ExtensionStateContext"
import { validateApiConfiguration } from "../../utils/validate"
import { vscode } from "../../utils/vscode"
import ApiOptions from "../settings/ApiOptions"
import { Tab, TabContent } from "../common/Tab"
import { Alert } from "../common/Alert"

const WelcomeView = () => {
	const { apiConfiguration, currentApiConfigName, setApiConfiguration, uriScheme } = useExtensionState()

	const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)

	const handleSubmit = useCallback(() => {
		const error = validateApiConfiguration(apiConfiguration)

		if (error) {
			setErrorMessage(error)
			return
		}

		setErrorMessage(undefined)
		vscode.postMessage({ type: "upsertApiConfiguration", text: currentApiConfigName, apiConfiguration })
	}, [apiConfiguration, currentApiConfigName])

	return (
		<Tab>
			<TabContent className="flex flex-col gap-5">
				<h2 className="m-0 p-0">Hi, I'm Roo!</h2>
				<div>
					I can do all kinds of tasks thanks to the latest breakthroughs in agentic coding capabilities and
					access to tools that let me create & edit files, explore complex projects, use the browser, and
					execute terminal commands (with your permission, of course). I can even use MCP to create new tools
					and extend my own capabilities.
				</div>
				<Alert className="font-bold text-sm">To get started, this extension needs an API provider.</Alert>
				<ApiOptions
					fromWelcomeView
					apiConfiguration={apiConfiguration || {}}
					uriScheme={uriScheme}
					setApiConfigurationField={(field, value) => setApiConfiguration({ [field]: value })}
					errorMessage={errorMessage}
					setErrorMessage={setErrorMessage}
				/>
			</TabContent>
			<div className="sticky bottom-0 bg-vscode-sideBar-background p-5">
				<div className="flex flex-col gap-1">
					<VSCodeButton onClick={handleSubmit}>Let's go!</VSCodeButton>
					{errorMessage && <div className="text-vscode-errorForeground">{errorMessage}</div>}
				</div>
			</div>
		</Tab>
	)
}

export default WelcomeView

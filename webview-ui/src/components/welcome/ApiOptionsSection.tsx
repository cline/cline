import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { validateApiConfiguration } from "@/utils/validate"
import { vscode } from "@/utils/vscode"
import ApiOptions from "@/components/settings/ApiOptions"
// import { WebviewType } from "@shared/WebviewMessage" // Removed duplicate

import { Dispatch, SetStateAction } from "react" // Added import
import { WebviewType } from "@shared/WebviewMessage"

interface ApiOptionsSectionProps {
	showApiOptions: boolean
	webviewType: WebviewType
	setShowApiOptions?: Dispatch<SetStateAction<boolean>> // Added prop
}

const ApiOptionsSection = ({ showApiOptions, webviewType, setShowApiOptions }: ApiOptionsSectionProps) => {
	const { apiConfiguration } = useExtensionState()
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)

	const disableLetsGoButton = apiErrorMessage != null

	const handleSubmit = () => {
		vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
		const isConfigValid = validateApiConfiguration(apiConfiguration) === undefined
		if (setShowApiOptions && isConfigValid) {
			setShowApiOptions(false)
		}
		if (webviewType === "sidebar" && isConfigValid) {
			// This message should be handled by the Controller,
			// which can then send an appropriate ExtensionMessage back to the webview
			// to hide the welcome screen.
			vscode.postMessage({ type: "showChatView" })
		}
	}

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(apiConfiguration))
	}, [apiConfiguration])

	if (!showApiOptions) {
		return null
	}

	return (
		<div className="mt-4.5 mb-8">
			<div>
				<ApiOptions showModelOptions={false} />
				<VSCodeButton onClick={handleSubmit} disabled={disableLetsGoButton} className="mt-0.75">
					Let's go!
				</VSCodeButton>
			</div>
		</div>
	)
}

export default ApiOptionsSection

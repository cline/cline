import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { validateApiConfiguration } from "@/utils/validate"
import { vscode } from "@/utils/vscode"
import ApiOptions from "@/components/settings/ApiOptions"

interface ApiOptionsSectionProps {
	showApiOptions: boolean
}

const ApiOptionsSection = ({ showApiOptions }: ApiOptionsSectionProps) => {
	const { apiConfiguration } = useExtensionState()
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)

	const disableLetsGoButton = apiErrorMessage != null

	const handleSubmit = () => {
		vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
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

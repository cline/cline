import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"

export const BeadsmithAccountInfoCard = () => {
	const { navigateToSettings } = useExtensionState()

	const handleConfigureProviders = () => {
		navigateToSettings("api-config")
	}

	return (
		<div className="max-w-[600px]">
			<p className="text-sm text-(--vscode-descriptionForeground) mb-2">
				Configure your AI provider in Settings to get started with Beadsmith.
			</p>
			<VSCodeButton appearance="secondary" onClick={handleConfigureProviders}>
				Configure Providers
			</VSCodeButton>
		</div>
	)
}

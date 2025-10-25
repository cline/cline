import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useCallback } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import Section from "../Section"

interface DebugSectionProps {
	onResetState: (resetGlobalState?: boolean) => Promise<void>
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const DebugSection = ({ onResetState, renderSectionHeader }: DebugSectionProps) => {
	const { hideSettings, setShowWelcome } = useExtensionState()

	const resetOnboardingView = useCallback(() => {
		hideSettings()
		setShowWelcome(true)
	}, [])

	return (
		<div>
			{renderSectionHeader("debug")}
			<Section>
				<VSCodeButton
					className="mt-[5px] w-auto"
					onClick={() => onResetState()}
					style={{ backgroundColor: "var(--vscode-errorForeground)", color: "black" }}>
					Reset Workspace State
				</VSCodeButton>
				<VSCodeButton
					className="mt-[5px] w-auto"
					onClick={() => onResetState(true)}
					style={{ backgroundColor: "var(--vscode-errorForeground)", color: "black" }}>
					Reset Global State
				</VSCodeButton>
				<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
					This will reset all global state and secret storage in the extension.
				</p>
			</Section>

			<Section>
				<VSCodeButton className="mt-[5px] w-auto" onClick={resetOnboardingView}>
					Reset Onboarding View
				</VSCodeButton>
			</Section>
		</div>
	)
}

export default DebugSection

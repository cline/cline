import Section from "../Section"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

interface DebugSectionProps {
	onResetState: (resetGlobalState?: boolean) => Promise<void>
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const DebugSection = ({ onResetState, renderSectionHeader }: DebugSectionProps) => {
	return (
		<div>
			{renderSectionHeader("debug")}
			<Section>
				<VSCodeButton
					onClick={() => onResetState()}
					className="mt-[5px] w-auto"
					style={{ backgroundColor: "var(--vscode-errorForeground)", color: "black" }}>
					Reset Workspace State
				</VSCodeButton>
				<VSCodeButton
					onClick={() => onResetState(true)}
					className="mt-[5px] w-auto"
					style={{ backgroundColor: "var(--vscode-errorForeground)", color: "black" }}>
					Reset Global State
				</VSCodeButton>
				<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
					This will reset all global state and secret storage in the extension.
				</p>
			</Section>
		</div>
	)
}

export default DebugSection

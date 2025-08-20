import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import Section from "../Section"

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
				<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
					This will reset all global state and secret storage in the extension.
				</p>
			</Section>
		</div>
	)
}

export default DebugSection

import React from "react"
import { VSCodeTextArea } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { memo } from "react"
import { DEFAULT_GIT_SETTINGS } from "../../../../src/shared/GitSettings"

const GitSettingsSection: React.FC = () => {
	const { gitSettings, setGitSettings } = useExtensionState()

	const handleInstructionsChange = (e: any) => {
		setGitSettings({
			...gitSettings,
			commitMessageInstructions: e.target.value || DEFAULT_GIT_SETTINGS.commitMessageInstructions,
		})
	}

	return (
		<div style={{ marginBottom: 20, borderTop: "1px solid var(--vscode-panel-border)", paddingTop: 15 }}>
			<h3 style={{ color: "var(--vscode-foreground)", margin: "0 0 10px 0", fontSize: "14px" }}>Git Settings</h3>

			<div className="mb-[5px]">
				<VSCodeTextArea
					value={gitSettings?.commitMessageInstructions || DEFAULT_GIT_SETTINGS.commitMessageInstructions}
					className="w-full"
					resize="vertical"
					rows={4}
					placeholder={DEFAULT_GIT_SETTINGS.commitMessageInstructions}
					onInput={handleInstructionsChange}>
					<span className="font-medium">Commit Message Instructions</span>
				</VSCodeTextArea>
				<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
					These instructions are used when generating commit messages. They define the format and style of the commit
					message.
				</p>
			</div>
		</div>
	)
}

export default memo(GitSettingsSection)

import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import React, { useCallback, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { updateSetting } from "./utils/settingsHandlers"

interface CustomPromptCheckboxProps {
	providerId: string
}

/**
 * Checkbox to enable or disable the use of a compact prompt for local models providers.
 */
const UseCustomPromptCheckbox: React.FC<CustomPromptCheckboxProps> = ({ providerId }) => {
	const { customPrompt } = useExtensionState()
	const [isCompactPromptEnabled, setIsCompactPromptEnabled] = useState<boolean>(customPrompt === "compact")

	const toggleCompactPrompt = useCallback((isChecked: boolean) => {
		setIsCompactPromptEnabled(isChecked)
		updateSetting("customPrompt", isChecked ? "compact" : "")
	}, [])

	return (
		<div id={providerId}>
			<VSCodeCheckbox checked={isCompactPromptEnabled} onChange={() => toggleCompactPrompt(!isCompactPromptEnabled)}>
				Use compact prompt
			</VSCodeCheckbox>
			<div className="text-xs text-description">
				A system prompt optimized for smaller context window (e.g. 8k or less).
				<div className="text-error flex align-middle">
					<i className="codicon codicon-x" />
					Does not support Mcp and Focus Chain
				</div>
			</div>
		</div>
	)
}

export default UseCustomPromptCheckbox

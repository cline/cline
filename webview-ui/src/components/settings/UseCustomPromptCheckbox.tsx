import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import React, { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
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
	const { t } = useTranslation("common")

	const toggleCompactPrompt = useCallback((isChecked: boolean) => {
		setIsCompactPromptEnabled(isChecked)
		updateSetting("customPrompt", isChecked ? "compact" : "")
	}, [])

	return (
		<div id={providerId}>
			<VSCodeCheckbox checked={isCompactPromptEnabled} onChange={() => toggleCompactPrompt(!isCompactPromptEnabled)}>
				{t("settings.general.use_compact_prompt")}
			</VSCodeCheckbox>
			<div className="text-xs text-description">
				{t("settings.general.use_compact_prompt_description")}
				<div className="text-error flex align-middle">
					<i className="codicon codicon-x" />
					{t("settings.general.use_compact_prompt_warning")}
				</div>
			</div>
		</div>
	)
}

export default UseCustomPromptCheckbox

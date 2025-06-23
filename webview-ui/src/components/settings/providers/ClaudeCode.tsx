import React from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { type ProviderSettings } from "@roo-code/types"
import { useAppTranslation } from "@src/i18n/TranslationContext"

interface ClaudeCodeProps {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const ClaudeCode: React.FC<ClaudeCodeProps> = ({ apiConfiguration, setApiConfigurationField }) => {
	const { t } = useAppTranslation()

	const handleInputChange = (e: Event | React.FormEvent<HTMLElement>) => {
		const element = e.target as HTMLInputElement
		setApiConfigurationField("claudeCodePath", element.value)
	}

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.claudeCodePath || ""}
				style={{ width: "100%", marginTop: 3 }}
				type="text"
				onInput={handleInputChange}
				placeholder={t("settings:providers.claudeCode.placeholder")}>
				{t("settings:providers.claudeCode.pathLabel")}
			</VSCodeTextField>

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				{t("settings:providers.claudeCode.description")}
			</p>
		</div>
	)
}

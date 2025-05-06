import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import { ApiConfiguration } from "@roo/shared/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"

interface PromptCachingControlProps {
	apiConfiguration: ApiConfiguration
	setApiConfigurationField: <K extends keyof ApiConfiguration>(field: K, value: ApiConfiguration[K]) => void
}

export const PromptCachingControl = ({ apiConfiguration, setApiConfigurationField }: PromptCachingControlProps) => {
	const { t } = useAppTranslation()

	return (
		<>
			<div>
				<VSCodeCheckbox
					checked={apiConfiguration.promptCachingDisabled}
					onChange={(e: any) => setApiConfigurationField("promptCachingDisabled", e.target.checked)}>
					<label className="block font-medium mb-1">{t("settings:promptCaching.label")}</label>
				</VSCodeCheckbox>
				<div className="text-sm text-vscode-descriptionForeground mt-1">
					{t("settings:promptCaching.description")}
				</div>
			</div>
		</>
	)
}

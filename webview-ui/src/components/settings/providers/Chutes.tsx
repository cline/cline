import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { ApiConfiguration } from "@roo/shared/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"

type ChutesProps = {
	apiConfiguration: ApiConfiguration
	setApiConfigurationField: (field: keyof ApiConfiguration, value: ApiConfiguration[keyof ApiConfiguration]) => void
}

export const Chutes = ({ apiConfiguration, setApiConfigurationField }: ChutesProps) => {
	const { t } = useAppTranslation()

	const handleInputChange = useCallback(
		<K extends keyof ApiConfiguration, E>(
			field: K,
			transform: (event: E) => ApiConfiguration[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.chutesApiKey || ""}
				type="password"
				onInput={handleInputChange("chutesApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.chutesApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.chutesApiKey && (
				<VSCodeButtonLink href="https://chutes.ai/app/api" appearance="secondary">
					{t("settings:providers.getChutesApiKey")}
				</VSCodeButtonLink>
			)}
		</>
	)
}

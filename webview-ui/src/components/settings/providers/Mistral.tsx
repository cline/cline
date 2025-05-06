import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { ApiConfiguration, RouterModels, mistralDefaultModelId } from "@roo/shared/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"

type MistralProps = {
	apiConfiguration: ApiConfiguration
	setApiConfigurationField: (field: keyof ApiConfiguration, value: ApiConfiguration[keyof ApiConfiguration]) => void
	routerModels?: RouterModels
}

export const Mistral = ({ apiConfiguration, setApiConfigurationField }: MistralProps) => {
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
				value={apiConfiguration?.mistralApiKey || ""}
				type="password"
				onInput={handleInputChange("mistralApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<span className="font-medium">{t("settings:providers.mistralApiKey")}</span>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.mistralApiKey && (
				<VSCodeButtonLink href="https://console.mistral.ai/" appearance="secondary">
					{t("settings:providers.getMistralApiKey")}
				</VSCodeButtonLink>
			)}
			{(apiConfiguration?.apiModelId?.startsWith("codestral-") ||
				(!apiConfiguration?.apiModelId && mistralDefaultModelId.startsWith("codestral-"))) && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.mistralCodestralUrl || ""}
						type="url"
						onInput={handleInputChange("mistralCodestralUrl")}
						placeholder="https://codestral.mistral.ai"
						className="w-full">
						<label className="block font-medium mb-1">{t("settings:providers.codestralBaseUrl")}</label>
					</VSCodeTextField>
					<div className="text-sm text-vscode-descriptionForeground -mt-2">
						{t("settings:providers.codestralBaseUrlDesc")}
					</div>
				</>
			)}
		</>
	)
}

import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { ApiConfiguration, RouterModels, litellmDefaultModelId } from "@roo/shared/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"

import { inputEventTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"

type LiteLLMProps = {
	apiConfiguration: ApiConfiguration
	setApiConfigurationField: (field: keyof ApiConfiguration, value: ApiConfiguration[keyof ApiConfiguration]) => void
	routerModels?: RouterModels
}

export const LiteLLM = ({ apiConfiguration, setApiConfigurationField, routerModels }: LiteLLMProps) => {
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
				value={apiConfiguration?.litellmBaseUrl || "http://localhost:4000"}
				onInput={handleInputChange("litellmBaseUrl")}
				placeholder="http://localhost:4000"
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.litellmBaseUrl")}</label>
			</VSCodeTextField>

			<VSCodeTextField
				value={apiConfiguration?.litellmApiKey || ""}
				type="password"
				onInput={handleInputChange("litellmApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.litellmApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>

			<ModelPicker
				apiConfiguration={apiConfiguration}
				defaultModelId={litellmDefaultModelId}
				models={routerModels?.litellm ?? {}}
				modelIdKey="litellmModelId"
				serviceName="LiteLLM"
				serviceUrl="https://docs.litellm.ai/"
				setApiConfigurationField={setApiConfigurationField}
			/>
		</>
	)
}

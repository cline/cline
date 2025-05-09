import { useState, useCallback } from "react"
import { useEvent } from "react-use"
import { VSCodeTextField, VSCodeRadioGroup, VSCodeRadio } from "@vscode/webview-ui-toolkit/react"

import { ProviderSettings } from "@roo/shared/api"
import { ExtensionMessage } from "@roo/shared/ExtensionMessage"

import { useAppTranslation } from "@src/i18n/TranslationContext"

import { inputEventTransform } from "../transforms"

type OllamaProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const Ollama = ({ apiConfiguration, setApiConfigurationField }: OllamaProps) => {
	const { t } = useAppTranslation()

	const [ollamaModels, setOllamaModels] = useState<string[]>([])

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	const onMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data

		switch (message.type) {
			case "ollamaModels":
				{
					const newModels = message.ollamaModels ?? []
					setOllamaModels(newModels)
				}
				break
		}
	}, [])

	useEvent("message", onMessage)

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.ollamaBaseUrl || ""}
				type="url"
				onInput={handleInputChange("ollamaBaseUrl")}
				placeholder={t("settings:defaults.ollamaUrl")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.ollama.baseUrl")}</label>
			</VSCodeTextField>
			<VSCodeTextField
				value={apiConfiguration?.ollamaModelId || ""}
				onInput={handleInputChange("ollamaModelId")}
				placeholder={t("settings:placeholders.modelId.ollama")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.ollama.modelId")}</label>
			</VSCodeTextField>
			{ollamaModels.length > 0 && (
				<VSCodeRadioGroup
					value={
						ollamaModels.includes(apiConfiguration?.ollamaModelId || "")
							? apiConfiguration?.ollamaModelId
							: ""
					}
					onChange={handleInputChange("ollamaModelId")}>
					{ollamaModels.map((model) => (
						<VSCodeRadio key={model} value={model} checked={apiConfiguration?.ollamaModelId === model}>
							{model}
						</VSCodeRadio>
					))}
				</VSCodeRadioGroup>
			)}
			<div className="text-sm text-vscode-descriptionForeground">
				{t("settings:providers.ollama.description")}
				<span className="text-vscode-errorForeground ml-1">{t("settings:providers.ollama.warning")}</span>
			</div>
		</>
	)
}

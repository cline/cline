import { useState, useCallback } from "react"
import { useEvent } from "react-use"
import { LanguageModelChatSelector } from "vscode"

import { ProviderSettings } from "@roo/shared/api"
import { ExtensionMessage } from "@roo/shared/ExtensionMessage"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

import { inputEventTransform } from "../transforms"

type VSCodeLMProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const VSCodeLM = ({ apiConfiguration, setApiConfigurationField }: VSCodeLMProps) => {
	const { t } = useAppTranslation()

	const [vsCodeLmModels, setVsCodeLmModels] = useState<LanguageModelChatSelector[]>([])

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
			case "vsCodeLmModels":
				{
					const newModels = message.vsCodeLmModels ?? []
					setVsCodeLmModels(newModels)
				}
				break
		}
	}, [])

	useEvent("message", onMessage)

	return (
		<>
			<div>
				<label className="block font-medium mb-1">{t("settings:providers.vscodeLmModel")}</label>
				{vsCodeLmModels.length > 0 ? (
					<Select
						value={
							apiConfiguration?.vsCodeLmModelSelector
								? `${apiConfiguration.vsCodeLmModelSelector.vendor ?? ""}/${apiConfiguration.vsCodeLmModelSelector.family ?? ""}`
								: ""
						}
						onValueChange={handleInputChange("vsCodeLmModelSelector", (value) => {
							const [vendor, family] = value.split("/")
							return { vendor, family }
						})}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder={t("settings:common.select")} />
						</SelectTrigger>
						<SelectContent>
							{vsCodeLmModels.map((model) => (
								<SelectItem
									key={`${model.vendor}/${model.family}`}
									value={`${model.vendor}/${model.family}`}>
									{`${model.vendor} - ${model.family}`}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : (
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.vscodeLmDescription")}
					</div>
				)}
			</div>
			<div className="text-sm text-vscode-errorForeground">{t("settings:providers.vscodeLmWarning")}</div>
		</>
	)
}

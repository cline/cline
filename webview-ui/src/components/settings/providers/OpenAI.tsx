import { useCallback, useState } from "react"
import { Checkbox } from "vscrui"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import type { ModelInfo, ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StandardTooltip } from "@src/components/ui"

import { inputEventTransform } from "../transforms"

type OpenAIProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	selectedModelInfo?: ModelInfo
}

export const OpenAI = ({ apiConfiguration, setApiConfigurationField, selectedModelInfo }: OpenAIProps) => {
	const { t } = useAppTranslation()

	const [openAiNativeBaseUrlSelected, setOpenAiNativeBaseUrlSelected] = useState(
		!!apiConfiguration?.openAiNativeBaseUrl,
	)

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

	return (
		<>
			<Checkbox
				checked={openAiNativeBaseUrlSelected}
				onChange={(checked: boolean) => {
					setOpenAiNativeBaseUrlSelected(checked)

					if (!checked) {
						setApiConfigurationField("openAiNativeBaseUrl", "")
					}
				}}>
				{t("settings:providers.useCustomBaseUrl")}
			</Checkbox>
			{openAiNativeBaseUrlSelected && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.openAiNativeBaseUrl || ""}
						type="url"
						onInput={handleInputChange("openAiNativeBaseUrl")}
						placeholder="https://api.openai.com/v1"
						className="w-full mt-1"
					/>
				</>
			)}
			<VSCodeTextField
				value={apiConfiguration?.openAiNativeApiKey || ""}
				type="password"
				onInput={handleInputChange("openAiNativeApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.openAiApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.openAiNativeApiKey && (
				<VSCodeButtonLink href="https://platform.openai.com/api-keys" appearance="secondary">
					{t("settings:providers.getOpenAiApiKey")}
				</VSCodeButtonLink>
			)}

			{(() => {
				const allowedTiers = (selectedModelInfo?.tiers?.map((t) => t.name).filter(Boolean) || []).filter(
					(t) => t === "flex" || t === "priority",
				)
				if (allowedTiers.length === 0) return null

				return (
					<div className="flex flex-col gap-1 mt-2" data-testid="openai-service-tier">
						<div className="flex items-center gap-1">
							<label className="block font-medium mb-1">Service tier</label>
							<StandardTooltip content="For faster processing of API requests, try the priority processing service tier. For lower prices with higher latency, try the flex processing tier.">
								<i className="codicon codicon-info text-vscode-descriptionForeground text-xs" />
							</StandardTooltip>
						</div>

						<Select
							value={apiConfiguration.openAiNativeServiceTier || "default"}
							onValueChange={(value) =>
								setApiConfigurationField(
									"openAiNativeServiceTier",
									value as ProviderSettings["openAiNativeServiceTier"],
								)
							}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder={t("settings:common.select")} />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="default">Standard</SelectItem>
								{allowedTiers.includes("flex") && <SelectItem value="flex">Flex</SelectItem>}
								{allowedTiers.includes("priority") && (
									<SelectItem value="priority">Priority</SelectItem>
								)}
							</SelectContent>
						</Select>
					</div>
				)
			})()}
		</>
	)
}

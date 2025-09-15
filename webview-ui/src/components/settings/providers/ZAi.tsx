import { useCallback } from "react"
import { VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"

import { zaiApiLineConfigs, zaiApiLineSchema, type ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"
import { cn } from "@/lib/utils"

type ZAiProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const ZAi = ({ apiConfiguration, setApiConfigurationField }: ZAiProps) => {
	const { t } = useAppTranslation()

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
			<div>
				<label className="block font-medium mb-1">{t("settings:providers.zaiEntrypoint")}</label>
				<VSCodeDropdown
					value={apiConfiguration.zaiApiLine || zaiApiLineSchema.enum.international_coding}
					onChange={handleInputChange("zaiApiLine")}
					className={cn("w-full")}>
					{zaiApiLineSchema.options.map((zaiApiLine) => {
						const config = zaiApiLineConfigs[zaiApiLine]
						return (
							<VSCodeOption key={zaiApiLine} value={zaiApiLine} className="p-2">
								{config.name} ({config.baseUrl})
							</VSCodeOption>
						)
					})}
				</VSCodeDropdown>
				<div className="text-xs text-vscode-descriptionForeground mt-1">
					{t("settings:providers.zaiEntrypointDescription")}
				</div>
			</div>
			<div>
				<VSCodeTextField
					value={apiConfiguration?.zaiApiKey || ""}
					type="password"
					onInput={handleInputChange("zaiApiKey")}
					placeholder={t("settings:placeholders.apiKey")}
					className="w-full">
					<label className="block font-medium mb-1">{t("settings:providers.zaiApiKey")}</label>
				</VSCodeTextField>
				<div className="text-sm text-vscode-descriptionForeground">
					{t("settings:providers.apiKeyStorageNotice")}
				</div>
				{!apiConfiguration?.zaiApiKey && (
					<VSCodeButtonLink
						href={
							zaiApiLineConfigs[apiConfiguration.zaiApiLine ?? "international_coding"].isChina
								? "https://open.bigmodel.cn/console/overview"
								: "https://z.ai/manage-apikey/apikey-list"
						}
						appearance="secondary">
						{t("settings:providers.getZaiApiKey")}
					</VSCodeButtonLink>
				)}
			</div>
		</>
	)
}

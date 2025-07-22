import { useCallback } from "react"
import { VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"
import { cn } from "@/lib/utils"

type MoonshotProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const Moonshot = ({ apiConfiguration, setApiConfigurationField }: MoonshotProps) => {
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
				<label className="block font-medium mb-1">{t("settings:providers.moonshotBaseUrl")}</label>
				<VSCodeDropdown
					value={apiConfiguration.moonshotBaseUrl}
					onChange={handleInputChange("moonshotBaseUrl")}
					className={cn("w-full")}>
					<VSCodeOption value="https://api.moonshot.ai/v1" className="p-2">
						api.moonshot.ai
					</VSCodeOption>
					<VSCodeOption value="https://api.moonshot.cn/v1" className="p-2">
						api.moonshot.cn
					</VSCodeOption>
				</VSCodeDropdown>
			</div>
			<div>
				<VSCodeTextField
					value={apiConfiguration?.moonshotApiKey || ""}
					type="password"
					onInput={handleInputChange("moonshotApiKey")}
					placeholder={t("settings:placeholders.apiKey")}
					className="w-full">
					<label className="block font-medium mb-1">{t("settings:providers.moonshotApiKey")}</label>
				</VSCodeTextField>
				<div className="text-sm text-vscode-descriptionForeground">
					{t("settings:providers.apiKeyStorageNotice")}
				</div>
				{!apiConfiguration?.moonshotApiKey && (
					<VSCodeButtonLink
						href={
							apiConfiguration.moonshotBaseUrl === "https://api.moonshot.cn/v1"
								? "https://platform.moonshot.cn/console/api-keys"
								: "https://platform.moonshot.ai/console/api-keys"
						}
						appearance="secondary">
						{t("settings:providers.getMoonshotApiKey")}
					</VSCodeButtonLink>
				)}
			</div>
		</>
	)
}

import { useCallback, useState } from "react"
import { Trans } from "react-i18next"
import { Checkbox } from "vscrui"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { ApiConfiguration } from "@roo/shared/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { getOpenRouterAuthUrl } from "@src/oauth/urls"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform, noTransform } from "../transforms"

import { OpenRouterBalanceDisplay } from "./OpenRouterBalanceDisplay"

type OpenRouterProps = {
	apiConfiguration: ApiConfiguration
	setApiConfigurationField: (field: keyof ApiConfiguration, value: ApiConfiguration[keyof ApiConfiguration]) => void
	uriScheme: string | undefined
	fromWelcomeView?: boolean
}

export const OpenRouter = ({
	apiConfiguration,
	setApiConfigurationField,
	uriScheme,
	fromWelcomeView,
}: OpenRouterProps) => {
	const { t } = useAppTranslation()

	const [openRouterBaseUrlSelected, setOpenRouterBaseUrlSelected] = useState(!!apiConfiguration?.openRouterBaseUrl)

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
				value={apiConfiguration?.openRouterApiKey || ""}
				type="password"
				onInput={handleInputChange("openRouterApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<div className="flex justify-between items-center mb-1">
					<label className="block font-medium">{t("settings:providers.openRouterApiKey")}</label>
					{apiConfiguration?.openRouterApiKey && (
						<OpenRouterBalanceDisplay
							apiKey={apiConfiguration.openRouterApiKey}
							baseUrl={apiConfiguration.openRouterBaseUrl}
						/>
					)}
				</div>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.openRouterApiKey && (
				<VSCodeButtonLink href={getOpenRouterAuthUrl(uriScheme)} style={{ width: "100%" }} appearance="primary">
					{t("settings:providers.getOpenRouterApiKey")}
				</VSCodeButtonLink>
			)}
			{!fromWelcomeView && (
				<>
					<div>
						<Checkbox
							checked={openRouterBaseUrlSelected}
							onChange={(checked: boolean) => {
								setOpenRouterBaseUrlSelected(checked)

								if (!checked) {
									setApiConfigurationField("openRouterBaseUrl", "")
								}
							}}>
							{t("settings:providers.useCustomBaseUrl")}
						</Checkbox>
						{openRouterBaseUrlSelected && (
							<VSCodeTextField
								value={apiConfiguration?.openRouterBaseUrl || ""}
								type="url"
								onInput={handleInputChange("openRouterBaseUrl")}
								placeholder="Default: https://openrouter.ai/api/v1"
								className="w-full mt-1"
							/>
						)}
					</div>
					<Checkbox
						checked={apiConfiguration?.openRouterUseMiddleOutTransform ?? true}
						onChange={handleInputChange("openRouterUseMiddleOutTransform", noTransform)}>
						<Trans
							i18nKey="settings:providers.openRouterTransformsText"
							components={{
								// eslint-disable-next-line jsx-a11y/anchor-has-content
								a: <a href="https://openrouter.ai/docs/transforms" />,
							}}
						/>
					</Checkbox>
				</>
			)}
		</>
	)
}

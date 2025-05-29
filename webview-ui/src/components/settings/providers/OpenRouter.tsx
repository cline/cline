import { useCallback, useState } from "react"
import { Trans } from "react-i18next"
import { Checkbox } from "vscrui"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ExternalLinkIcon } from "@radix-ui/react-icons"

import type { ProviderSettings, OrganizationAllowList } from "@roo-code/types"

import { RouterModels, openRouterDefaultModelId } from "@roo/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { getOpenRouterAuthUrl } from "@src/oauth/urls"
import {
	useOpenRouterModelProviders,
	OPENROUTER_DEFAULT_PROVIDER_NAME,
} from "@src/components/ui/hooks/useOpenRouterModelProviders"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

import { inputEventTransform, noTransform } from "../transforms"

import { ModelPicker } from "../ModelPicker"
import { OpenRouterBalanceDisplay } from "./OpenRouterBalanceDisplay"

type OpenRouterProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	selectedModelId: string
	uriScheme: string | undefined
	fromWelcomeView?: boolean
	organizationAllowList: OrganizationAllowList
}

export const OpenRouter = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	selectedModelId,
	uriScheme,
	fromWelcomeView,
	organizationAllowList,
}: OpenRouterProps) => {
	const { t } = useAppTranslation()

	const [openRouterBaseUrlSelected, setOpenRouterBaseUrlSelected] = useState(!!apiConfiguration?.openRouterBaseUrl)

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

	const { data: openRouterModelProviders } = useOpenRouterModelProviders(apiConfiguration?.openRouterModelId, {
		enabled:
			!!apiConfiguration?.openRouterModelId &&
			routerModels?.openrouter &&
			Object.keys(routerModels.openrouter).length > 1 &&
			apiConfiguration.openRouterModelId in routerModels.openrouter,
	})

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
								a: <a href="https://openrouter.ai/docs/transforms" />,
							}}
						/>
					</Checkbox>
				</>
			)}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={openRouterDefaultModelId}
				models={routerModels?.openrouter ?? {}}
				modelIdKey="openRouterModelId"
				serviceName="OpenRouter"
				serviceUrl="https://openrouter.ai/models"
				organizationAllowList={organizationAllowList}
			/>
			{openRouterModelProviders && Object.keys(openRouterModelProviders).length > 0 && (
				<div>
					<div className="flex items-center gap-1">
						<label className="block font-medium mb-1">
							{t("settings:providers.openRouter.providerRouting.title")}
						</label>
						<a href={`https://openrouter.ai/${selectedModelId}/providers`}>
							<ExternalLinkIcon className="w-4 h-4" />
						</a>
					</div>
					<Select
						value={apiConfiguration?.openRouterSpecificProvider || OPENROUTER_DEFAULT_PROVIDER_NAME}
						onValueChange={(value) => setApiConfigurationField("openRouterSpecificProvider", value)}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder={t("settings:common.select")} />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={OPENROUTER_DEFAULT_PROVIDER_NAME}>
								{OPENROUTER_DEFAULT_PROVIDER_NAME}
							</SelectItem>
							{Object.entries(openRouterModelProviders).map(([value, { label }]) => (
								<SelectItem key={value} value={value}>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<div className="text-sm text-vscode-descriptionForeground mt-1">
						{t("settings:providers.openRouter.providerRouting.description")}{" "}
						<a href="https://openrouter.ai/docs/features/provider-routing">
							{t("settings:providers.openRouter.providerRouting.learnMore")}.
						</a>
					</div>
				</div>
			)}
		</>
	)
}

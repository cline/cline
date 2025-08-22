import { useCallback, useEffect, useState } from "react"
import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { type ProviderSettings, requestyDefaultModelId } from "@roo-code/types"

import type { OrganizationAllowList } from "@roo/cloud"
import type { RouterModels } from "@roo/api"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button } from "@src/components/ui"

import { inputEventTransform } from "../transforms"
import { ModelPicker } from "../ModelPicker"
import { RequestyBalanceDisplay } from "./RequestyBalanceDisplay"
import { getCallbackUrl } from "@/oauth/urls"
import { toRequestyServiceUrl } from "@roo/utils/requesty"

type RequestyProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	refetchRouterModels: () => void
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
	uriScheme?: string
}

export const Requesty = ({
	apiConfiguration,
	setApiConfigurationField,
	routerModels,
	refetchRouterModels,
	organizationAllowList,
	modelValidationError,
	uriScheme,
}: RequestyProps) => {
	const { t } = useAppTranslation()

	const [didRefetch, setDidRefetch] = useState<boolean>()

	const [requestyEndpointSelected, setRequestyEndpointSelected] = useState(!!apiConfiguration.requestyBaseUrl)

	// This ensures that the "Use custom URL" checkbox is hidden when the user deletes the URL.
	useEffect(() => {
		setRequestyEndpointSelected(!!apiConfiguration?.requestyBaseUrl)
	}, [apiConfiguration?.requestyBaseUrl])

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

	const getApiKeyUrl = () => {
		const callbackUrl = getCallbackUrl("requesty", uriScheme)
		const baseUrl = toRequestyServiceUrl(apiConfiguration.requestyBaseUrl, "app")

		const authUrl = new URL(`oauth/authorize?callback_url=${callbackUrl}`, baseUrl)

		return authUrl.toString()
	}

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.requestyApiKey || ""}
				type="password"
				onInput={handleInputChange("requestyApiKey")}
				placeholder={t("settings:providers.getRequestyApiKey")}
				className="w-full">
				<div className="flex justify-between items-center mb-1">
					<label className="block font-medium">{t("settings:providers.requestyApiKey")}</label>
					{apiConfiguration?.requestyApiKey && (
						<RequestyBalanceDisplay
							baseUrl={apiConfiguration.requestyBaseUrl}
							apiKey={apiConfiguration.requestyApiKey}
						/>
					)}
				</div>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.requestyApiKey && (
				<a
					href={getApiKeyUrl()}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 rounded-md px-3 w-full"
					style={{
						width: "100%",
						textDecoration: "none",
						color: "var(--vscode-button-foreground)",
						backgroundColor: "var(--vscode-button-background)",
					}}>
					{t("settings:providers.getRequestyApiKey")}
				</a>
			)}

			<VSCodeCheckbox
				checked={requestyEndpointSelected}
				onChange={(e: any) => {
					const isChecked = e.target.checked === true
					if (!isChecked) {
						setApiConfigurationField("requestyBaseUrl", undefined)
					}

					setRequestyEndpointSelected(isChecked)
				}}>
				{t("settings:providers.requestyUseCustomBaseUrl")}
			</VSCodeCheckbox>
			{requestyEndpointSelected && (
				<VSCodeTextField
					value={apiConfiguration?.requestyBaseUrl || ""}
					type="text"
					onInput={handleInputChange("requestyBaseUrl")}
					placeholder={t("settings:providers.getRequestyBaseUrl")}
					className="w-full">
					<div className="flex justify-between items-center mb-1">
						<label className="block font-medium">{t("settings:providers.getRequestyBaseUrl")}</label>
					</div>
				</VSCodeTextField>
			)}
			<Button
				variant="outline"
				onClick={() => {
					vscode.postMessage({ type: "flushRouterModels", text: "requesty" })
					refetchRouterModels()
					setDidRefetch(true)
				}}>
				<div className="flex items-center gap-2">
					<span className="codicon codicon-refresh" />
					{t("settings:providers.refreshModels.label")}
				</div>
			</Button>
			{didRefetch && (
				<div className="flex items-center text-vscode-errorForeground">
					{t("settings:providers.refreshModels.hint")}
				</div>
			)}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={requestyDefaultModelId}
				models={routerModels?.requesty ?? {}}
				modelIdKey="requestyModelId"
				serviceName="Requesty"
				serviceUrl="https://requesty.ai"
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
			/>
		</>
	)
}

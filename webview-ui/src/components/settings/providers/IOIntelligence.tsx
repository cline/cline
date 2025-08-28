import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import {
	type ProviderSettings,
	type OrganizationAllowList,
	ioIntelligenceDefaultModelId,
	ioIntelligenceModels,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"
import { useExtensionState } from "@src/context/ExtensionStateContext"

import { ModelPicker } from "../ModelPicker"

import { inputEventTransform } from "../transforms"

type IOIntelligenceProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	organizationAllowList: OrganizationAllowList
	modelValidationError?: string
}

export const IOIntelligence = ({
	apiConfiguration,
	setApiConfigurationField,
	organizationAllowList,
	modelValidationError,
}: IOIntelligenceProps) => {
	const { t } = useAppTranslation()
	const { routerModels } = useExtensionState()

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
			<VSCodeTextField
				value={apiConfiguration?.ioIntelligenceApiKey || ""}
				type="password"
				onInput={handleInputChange("ioIntelligenceApiKey")}
				placeholder={t("settings:providers.ioIntelligenceApiKeyPlaceholder")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.ioIntelligenceApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.ioIntelligenceApiKey && (
				<VSCodeButtonLink href="https://ai.io.net/ai/api-keys" appearance="secondary">
					{t("settings:providers.getIoIntelligenceApiKey")}
				</VSCodeButtonLink>
			)}
			<ModelPicker
				apiConfiguration={apiConfiguration}
				defaultModelId={ioIntelligenceDefaultModelId}
				models={routerModels?.["io-intelligence"] ?? ioIntelligenceModels}
				modelIdKey="ioIntelligenceModelId"
				serviceName="IO Intelligence"
				serviceUrl="https://api.intelligence.io.solutions/api/v1/models"
				setApiConfigurationField={setApiConfigurationField}
				organizationAllowList={organizationAllowList}
				errorMessage={modelValidationError}
			/>
		</>
	)
}

import { useCallback } from "react"
import { Checkbox } from "vscrui"
import { VSCodeTextField, VSCodeRadio, VSCodeRadioGroup } from "@vscode/webview-ui-toolkit/react"

import { ProviderSettings, ModelInfo } from "@roo/shared/api"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

import { AWS_REGIONS } from "../constants"
import { inputEventTransform, noTransform } from "../transforms"

type BedrockProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	selectedModelInfo?: ModelInfo
}

export const Bedrock = ({ apiConfiguration, setApiConfigurationField, selectedModelInfo }: BedrockProps) => {
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
			<VSCodeRadioGroup
				value={apiConfiguration?.awsUseProfile ? "profile" : "credentials"}
				onChange={handleInputChange(
					"awsUseProfile",
					(e) => (e.target as HTMLInputElement).value === "profile",
				)}>
				<VSCodeRadio value="credentials">{t("settings:providers.awsCredentials")}</VSCodeRadio>
				<VSCodeRadio value="profile">{t("settings:providers.awsProfile")}</VSCodeRadio>
			</VSCodeRadioGroup>
			<div className="text-sm text-vscode-descriptionForeground -mt-3">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{apiConfiguration?.awsUseProfile ? (
				<VSCodeTextField
					value={apiConfiguration?.awsProfile || ""}
					onInput={handleInputChange("awsProfile")}
					placeholder={t("settings:placeholders.profileName")}
					className="w-full">
					<label className="block font-medium mb-1">{t("settings:providers.awsProfileName")}</label>
				</VSCodeTextField>
			) : (
				<>
					<VSCodeTextField
						value={apiConfiguration?.awsAccessKey || ""}
						type="password"
						onInput={handleInputChange("awsAccessKey")}
						placeholder={t("settings:placeholders.accessKey")}
						className="w-full">
						<label className="block font-medium mb-1">{t("settings:providers.awsAccessKey")}</label>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.awsSecretKey || ""}
						type="password"
						onInput={handleInputChange("awsSecretKey")}
						placeholder={t("settings:placeholders.secretKey")}
						className="w-full">
						<label className="block font-medium mb-1">{t("settings:providers.awsSecretKey")}</label>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.awsSessionToken || ""}
						type="password"
						onInput={handleInputChange("awsSessionToken")}
						placeholder={t("settings:placeholders.sessionToken")}
						className="w-full">
						<label className="block font-medium mb-1">{t("settings:providers.awsSessionToken")}</label>
					</VSCodeTextField>
				</>
			)}
			<div>
				<label className="block font-medium mb-1">{t("settings:providers.awsRegion")}</label>
				<Select
					value={apiConfiguration?.awsRegion || ""}
					onValueChange={(value) => setApiConfigurationField("awsRegion", value)}>
					<SelectTrigger className="w-full">
						<SelectValue placeholder={t("settings:common.select")} />
					</SelectTrigger>
					<SelectContent>
						{AWS_REGIONS.map(({ value, label }) => (
							<SelectItem key={value} value={value}>
								{label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<Checkbox
				checked={apiConfiguration?.awsUseCrossRegionInference || false}
				onChange={handleInputChange("awsUseCrossRegionInference", noTransform)}>
				{t("settings:providers.awsCrossRegion")}
			</Checkbox>
			{selectedModelInfo?.supportsPromptCache && (
				<Checkbox
					checked={apiConfiguration?.awsUsePromptCache || false}
					onChange={handleInputChange("awsUsePromptCache", noTransform)}>
					<div className="flex items-center gap-1">
						<span>{t("settings:providers.enablePromptCaching")}</span>
						<i
							className="codicon codicon-info text-vscode-descriptionForeground"
							title={t("settings:providers.enablePromptCachingTitle")}
							style={{ fontSize: "12px" }}
						/>
					</div>
				</Checkbox>
			)}
			<div>
				<div className="text-sm text-vscode-descriptionForeground ml-6 mt-1">
					{t("settings:providers.cacheUsageNote")}
				</div>
			</div>
		</>
	)
}

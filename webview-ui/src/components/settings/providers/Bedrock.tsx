import { useCallback, useState, useEffect } from "react"
import { Checkbox } from "vscrui"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { type ProviderSettings, type ModelInfo, BEDROCK_REGIONS, BEDROCK_1M_CONTEXT_MODEL_IDS } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, StandardTooltip } from "@src/components/ui"

import { inputEventTransform, noTransform } from "../transforms"

type BedrockProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	selectedModelInfo?: ModelInfo
}

export const Bedrock = ({ apiConfiguration, setApiConfigurationField, selectedModelInfo }: BedrockProps) => {
	const { t } = useAppTranslation()
	const [awsEndpointSelected, setAwsEndpointSelected] = useState(!!apiConfiguration?.awsBedrockEndpointEnabled)

	// Check if the selected model supports 1M context (Claude Sonnet 4 / 4.5)
	const supports1MContextBeta =
		!!apiConfiguration?.apiModelId && BEDROCK_1M_CONTEXT_MODEL_IDS.includes(apiConfiguration.apiModelId as any)

	// Update the endpoint enabled state when the configuration changes
	useEffect(() => {
		setAwsEndpointSelected(!!apiConfiguration?.awsBedrockEndpointEnabled)
	}, [apiConfiguration?.awsBedrockEndpointEnabled])

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
				<label className="block font-medium mb-1">Authentication Method</label>
				<Select
					value={
						apiConfiguration?.awsUseApiKey
							? "apikey"
							: apiConfiguration?.awsUseProfile
								? "profile"
								: "credentials"
					}
					onValueChange={(value) => {
						if (value === "apikey") {
							setApiConfigurationField("awsUseApiKey", true)
							setApiConfigurationField("awsUseProfile", false)
						} else if (value === "profile") {
							setApiConfigurationField("awsUseApiKey", false)
							setApiConfigurationField("awsUseProfile", true)
						} else {
							setApiConfigurationField("awsUseApiKey", false)
							setApiConfigurationField("awsUseProfile", false)
						}
					}}>
					<SelectTrigger className="w-full">
						<SelectValue placeholder={t("settings:common.select")} />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="credentials">{t("settings:providers.awsCredentials")}</SelectItem>
						<SelectItem value="profile">{t("settings:providers.awsProfile")}</SelectItem>
						<SelectItem value="apikey">{t("settings:providers.awsApiKey")}</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<div className="text-sm text-vscode-descriptionForeground -mt-3">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{apiConfiguration?.awsUseApiKey ? (
				<VSCodeTextField
					value={apiConfiguration?.awsApiKey || ""}
					type="password"
					onInput={handleInputChange("awsApiKey")}
					placeholder={t("settings:placeholders.apiKey")}
					className="w-full">
					<label className="block font-medium mb-1">{t("settings:providers.awsApiKey")}</label>
				</VSCodeTextField>
			) : apiConfiguration?.awsUseProfile ? (
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
						{BEDROCK_REGIONS.map(({ value, label }) => (
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
				<>
					<Checkbox
						checked={apiConfiguration?.awsUsePromptCache || false}
						onChange={handleInputChange("awsUsePromptCache", noTransform)}>
						<div className="flex items-center gap-1">
							<span>{t("settings:providers.enablePromptCaching")}</span>
							<StandardTooltip content={t("settings:providers.enablePromptCachingTitle")}>
								<i
									className="codicon codicon-info text-vscode-descriptionForeground"
									style={{ fontSize: "12px" }}
								/>
							</StandardTooltip>
						</div>
					</Checkbox>
					<div className="text-sm text-vscode-descriptionForeground ml-6 mt-1">
						{t("settings:providers.cacheUsageNote")}
					</div>
				</>
			)}
			{supports1MContextBeta && (
				<div>
					<Checkbox
						checked={apiConfiguration?.awsBedrock1MContext ?? false}
						onChange={(checked: boolean) => {
							setApiConfigurationField("awsBedrock1MContext", checked)
						}}>
						{t("settings:providers.awsBedrock1MContextBetaLabel")}
					</Checkbox>
					<div className="text-sm text-vscode-descriptionForeground mt-1 ml-6">
						{t("settings:providers.awsBedrock1MContextBetaDescription")}
					</div>
				</div>
			)}
			<Checkbox
				checked={awsEndpointSelected}
				onChange={(isChecked) => {
					setAwsEndpointSelected(isChecked)
					setApiConfigurationField("awsBedrockEndpointEnabled", isChecked)
				}}>
				{t("settings:providers.awsBedrockVpc.useCustomVpcEndpoint")}
			</Checkbox>
			{awsEndpointSelected && (
				<>
					<VSCodeTextField
						value={apiConfiguration?.awsBedrockEndpoint || ""}
						style={{ width: "100%", marginTop: 3, marginBottom: 5 }}
						type="url"
						onInput={handleInputChange("awsBedrockEndpoint")}
						placeholder={t("settings:providers.awsBedrockVpc.vpcEndpointUrlPlaceholder")}
						data-testid="vpc-endpoint-input"
					/>
					<div className="text-sm text-vscode-descriptionForeground ml-6 mt-1 mb-3">
						{t("settings:providers.awsBedrockVpc.examples")}
						<div className="ml-2">• https://vpce-xxx.bedrock.region.vpce.amazonaws.com/</div>
						<div className="ml-2">• https://gateway.my-company.com/route/app/bedrock</div>
					</div>
				</>
			)}
		</>
	)
}

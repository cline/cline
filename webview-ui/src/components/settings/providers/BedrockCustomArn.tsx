import { useMemo } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@roo-code/types"

import { validateBedrockArn } from "@src/utils/validate"
import { useAppTranslation } from "@src/i18n/TranslationContext"

type BedrockCustomArnProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const BedrockCustomArn = ({ apiConfiguration, setApiConfigurationField }: BedrockCustomArnProps) => {
	const { t } = useAppTranslation()

	const validation = useMemo(() => {
		const { awsCustomArn, awsRegion } = apiConfiguration
		return awsCustomArn ? validateBedrockArn(awsCustomArn, awsRegion) : { isValid: true, errorMessage: undefined }
	}, [apiConfiguration])

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.awsCustomArn || ""}
				onInput={(e) => setApiConfigurationField("awsCustomArn", (e.target as HTMLInputElement).value)}
				placeholder={t("settings:placeholders.customArn")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:labels.customArn")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.awsCustomArnUse")}
				<ul className="list-disc pl-5 mt-1">
					<li>
						arn:aws:bedrock:eu-west-1:123456789012:inference-profile/eu.anthropic.claude-3-7-sonnet-20250219-v1:0
					</li>
					<li>arn:aws:bedrock:us-west-2:123456789012:provisioned-model/my-provisioned-model</li>
					<li>arn:aws:bedrock:us-east-1:123456789012:default-prompt-router/anthropic.claude:1</li>
				</ul>
				{t("settings:providers.awsCustomArnDesc")}
			</div>
			{!validation.isValid ? (
				<div className="text-sm text-vscode-errorForeground mt-2">
					{validation.errorMessage || t("settings:providers.invalidArnFormat")}
				</div>
			) : (
				validation.errorMessage && (
					<div className="text-sm text-vscode-errorForeground mt-2">{validation.errorMessage}</div>
				)
			)}
		</>
	)
}

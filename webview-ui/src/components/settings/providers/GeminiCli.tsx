import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { inputEventTransform } from "../transforms"

type GeminiCliProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const GeminiCli = ({ apiConfiguration, setApiConfigurationField }: GeminiCliProps) => {
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
			<VSCodeTextField
				value={apiConfiguration?.geminiCliOAuthPath || ""}
				onInput={handleInputChange("geminiCliOAuthPath")}
				placeholder="~/.gemini/oauth_creds.json"
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.geminiCli.oauthPath")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.geminiCli.oauthPathDescription")}
			</div>

			<div className="text-sm text-vscode-descriptionForeground mt-3">
				{t("settings:providers.geminiCli.description")}
			</div>

			<div className="text-sm text-vscode-descriptionForeground mt-2">
				{t("settings:providers.geminiCli.instructions")}{" "}
				<code className="text-vscode-textPreformat-foreground">gemini</code>{" "}
				{t("settings:providers.geminiCli.instructionsContinued")}
			</div>

			<VSCodeLink
				href="https://github.com/google-gemini/gemini-cli?tab=readme-ov-file#quickstart"
				className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground mt-2 inline-block">
				{t("settings:providers.geminiCli.setupLink")}
			</VSCodeLink>

			<div className="mt-3 p-3 bg-vscode-editorWidget-background border border-vscode-editorWidget-border rounded">
				<div className="flex items-center gap-2 mb-2">
					<i className="codicon codicon-warning text-vscode-notificationsWarningIcon-foreground" />
					<span className="font-semibold text-sm">{t("settings:providers.geminiCli.requirementsTitle")}</span>
				</div>
				<ul className="list-disc list-inside space-y-1 text-sm text-vscode-descriptionForeground">
					<li>{t("settings:providers.geminiCli.requirement1")}</li>
					<li>{t("settings:providers.geminiCli.requirement2")}</li>
					<li>{t("settings:providers.geminiCli.requirement3")}</li>
					<li>{t("settings:providers.geminiCli.requirement4")}</li>
					<li>{t("settings:providers.geminiCli.requirement5")}</li>
				</ul>
			</div>

			<div className="mt-3 flex items-center gap-2">
				<i className="codicon codicon-check text-vscode-notificationsInfoIcon-foreground" />
				<span className="text-sm text-vscode-descriptionForeground">
					{t("settings:providers.geminiCli.freeAccess")}
				</span>
			</div>
		</>
	)
}

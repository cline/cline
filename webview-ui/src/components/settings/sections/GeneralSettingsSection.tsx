import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useTranslation } from "react-i18next"
import { updateAutoApproveSettings } from "@/components/chat/auto-approve-menu/AutoApproveSettingsAPI"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import PreferredLanguageSetting from "../PreferredLanguageSetting"
import Section from "../Section"
import UILanguageSetting from "../UILanguageSetting"
import { updateSetting } from "../utils/settingsHandlers"

interface GeneralSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const GeneralSettingsSection = ({ renderSectionHeader }: GeneralSettingsSectionProps) => {
	const { telemetrySetting, remoteConfigSettings, autoApprovalSettings } = useExtensionState()
	const { t } = useTranslation("common")

	return (
		<div>
			{renderSectionHeader("general")}
			<Section>
				<PreferredLanguageSetting />
				<UILanguageSetting />

				<div className="mb-[5px]" id="enable-notifications">
					<VSCodeCheckbox
						checked={autoApprovalSettings.enableNotifications}
						onChange={async (e: any) => {
							const checked = e.target.checked === true
							await updateAutoApproveSettings({
								...autoApprovalSettings,
								version: (autoApprovalSettings.version ?? 1) + 1,
								enableNotifications: checked,
							})
						}}>
						{t("settings.general.enable_notifications")}
					</VSCodeCheckbox>

					<p className="text-sm mt-[5px] text-description">{t("settings.general.enable_notifications_description")}</p>
				</div>

				<div className="mb-[5px]">
					<Tooltip>
						<TooltipContent hidden={remoteConfigSettings?.telemetrySetting === undefined}>
							{t("settings.general.remote_config_tooltip")}
						</TooltipContent>
						<TooltipTrigger asChild>
							<div className="flex items-center gap-2 mb-[5px]">
								<VSCodeCheckbox
									checked={telemetrySetting === "enabled"}
									disabled={remoteConfigSettings?.telemetrySetting === "disabled"}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										updateSetting("telemetrySetting", checked ? "enabled" : "disabled")
									}}>
									{t("settings.general.allow_error_usage_reporting")}
								</VSCodeCheckbox>
								{!!remoteConfigSettings?.telemetrySetting && (
									<i className="codicon codicon-lock text-description text-sm" />
								)}
							</div>
						</TooltipTrigger>
					</Tooltip>

					<p className="text-sm mt-[5px] text-description">
						{t("settings.general.allow_error_usage_reporting_description_part1")}
						<VSCodeLink
							className="text-inherit"
							href="https://docs.cline.bot/more-info/telemetry"
							style={{ fontSize: "inherit", textDecoration: "underline" }}>
							{t("settings.general.telemetry_overview_link")}
						</VSCodeLink>{" "}
						{t("settings.general.allow_error_usage_reporting_description_part2")}
						<VSCodeLink
							className="text-inherit"
							href="https://cline.bot/privacy"
							style={{ fontSize: "inherit", textDecoration: "underline" }}>
							{t("settings.general.privacy_policy_link")}
						</VSCodeLink>{" "}
						{t("settings.general.allow_error_usage_reporting_description_part3")}
					</p>
				</div>
			</Section>
		</div>
	)
}

export default GeneralSettingsSection

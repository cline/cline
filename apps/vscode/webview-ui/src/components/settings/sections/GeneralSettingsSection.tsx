import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Trans, useTranslation } from "react-i18next"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import PreferredLanguageSetting from "../PreferredLanguageSetting"
import Section from "../Section"
import UiLanguageSetting from "../UiLanguageSetting"
import { updateSetting } from "../utils/settingsHandlers"

interface GeneralSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const GeneralSettingsSection = ({ renderSectionHeader }: GeneralSettingsSectionProps) => {
	const { telemetrySetting, remoteConfigSettings } = useExtensionState()
	const { t } = useTranslation()

	return (
		<div>
			{renderSectionHeader("general")}
			<Section>
				<UiLanguageSetting />

				<PreferredLanguageSetting />

				<div className="mb-[5px]">
					<Tooltip>
						<TooltipContent hidden={remoteConfigSettings?.telemetrySetting === undefined}>
							{t("settings:remoteManaged.tooltip")}
						</TooltipContent>
						<TooltipTrigger asChild>
							<div className="flex items-center gap-2 mb-[5px]">
								<VSCodeCheckbox
									checked={telemetrySetting !== "disabled"}
									disabled={remoteConfigSettings?.telemetrySetting === "disabled"}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										updateSetting("telemetrySetting", checked ? "enabled" : "disabled")
									}}>
									{t("settings:general.telemetry.label")}
								</VSCodeCheckbox>
								{!!remoteConfigSettings?.telemetrySetting && (
									<i className="codicon codicon-lock text-description text-sm" />
								)}
							</div>
						</TooltipTrigger>
					</Tooltip>

					<p className="text-sm mt-[5px] text-description">
						<Trans
							components={{
								privacyLink: (
									<VSCodeLink
										className="text-inherit"
										href="https://cline.bot/privacy"
										style={{ fontSize: "inherit", textDecoration: "underline" }}
									/>
								),
								telemetryLink: (
									<VSCodeLink
										className="text-inherit"
										href="https://docs.cline.bot/more-info/telemetry"
										style={{ fontSize: "inherit", textDecoration: "underline" }}
									/>
								),
							}}
							i18nKey="settings:general.telemetry.description"
						/>
					</p>
				</div>
			</Section>
		</div>
	)
}

export default GeneralSettingsSection

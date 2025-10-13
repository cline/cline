import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import HeroTooltip from "@/components/common/HeroTooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import PreferredLanguageSetting from "../PreferredLanguageSetting"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface GeneralSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const GeneralSettingsSection = ({ renderSectionHeader }: GeneralSettingsSectionProps) => {
	const { telemetrySetting, remoteConfigSettings } = useExtensionState()
	const isDisabledByRemoteConfig = remoteConfigSettings?.telemetrySetting === "disabled"

	return (
		<div>
			{renderSectionHeader("general")}
			<Section>
				<PreferredLanguageSetting />

				<div className="mb-[5px]">
					{isDisabledByRemoteConfig ? (
						<HeroTooltip content="This setting is managed by your organization's remote configuration">
							<div className="flex items-center gap-2 mb-[5px]">
								<VSCodeCheckbox
									checked={telemetrySetting !== "disabled"}
									disabled={true}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										updateSetting("telemetrySetting", checked ? "enabled" : "disabled")
									}}>
									Allow error and usage reporting
								</VSCodeCheckbox>
								<i className="codicon codicon-lock text-[var(--vscode-descriptionForeground)] text-sm" />
							</div>
						</HeroTooltip>
					) : (
						<VSCodeCheckbox
							checked={telemetrySetting !== "disabled"}
							className="mb-[5px]"
							disabled={false}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("telemetrySetting", checked ? "enabled" : "disabled")
							}}>
							Allow error and usage reporting
						</VSCodeCheckbox>
					)}
					<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
						Help improve Cline by sending usage data and error reports. No code, prompts, or personal information are
						ever sent. See our{" "}
						<VSCodeLink
							className="text-inherit"
							href="https://docs.cline.bot/more-info/telemetry"
							style={{ fontSize: "inherit", textDecoration: "underline" }}>
							telemetry overview
						</VSCodeLink>{" "}
						and{" "}
						<VSCodeLink
							className="text-inherit"
							href="https://cline.bot/privacy"
							style={{ fontSize: "inherit", textDecoration: "underline" }}>
							privacy policy
						</VSCodeLink>{" "}
						for more details.
					</p>
				</div>
			</Section>
		</div>
	)
}

export default GeneralSettingsSection

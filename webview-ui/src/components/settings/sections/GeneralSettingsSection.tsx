import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { updateAutoApproveSettings } from "@/components/chat/auto-approve-menu/AutoApproveSettingsAPI"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import PreferredLanguageSetting from "../PreferredLanguageSetting"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface GeneralSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const GeneralSettingsSection = ({ renderSectionHeader }: GeneralSettingsSectionProps) => {
	const { telemetrySetting, remoteConfigSettings, autoApprovalSettings } = useExtensionState()

	return (
		<div>
			{renderSectionHeader("general")}
			<Section>
				<PreferredLanguageSetting />

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
						Enable notifications
					</VSCodeCheckbox>

					<p className="text-sm mt-[5px] text-description">
						Receive system notifications when Cline requires approval to proceed or when a task is completed.
					</p>
				</div>

				<div className="mb-[5px]">
					<Tooltip>
						<TooltipContent hidden={remoteConfigSettings?.telemetrySetting === undefined}>
							This setting is managed by your organization's remote configuration
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
									Allow error and usage reporting
								</VSCodeCheckbox>
								{!!remoteConfigSettings?.telemetrySetting && (
									<i className="codicon codicon-lock text-description text-sm" />
								)}
							</div>
						</TooltipTrigger>
					</Tooltip>

					<p className="text-sm mt-[5px] text-description">
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

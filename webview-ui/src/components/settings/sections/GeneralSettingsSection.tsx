import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FeatureGroup } from "../FeatureGroup"
import { FeatureItem } from "../FeatureItem"
import PreferredLanguageSetting from "../PreferredLanguageSetting"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface GeneralSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const GeneralSettingsSection = ({ renderSectionHeader }: GeneralSettingsSectionProps) => {
	const { telemetrySetting, remoteConfigSettings } = useExtensionState()

	return (
		<div>
			{renderSectionHeader("general")}
			<Section>
				<div className="grid grid-cols-1 gap-4">
					{/* LANGUAGE PREFERENCES */}
					<FeatureGroup isGridItem={false} title="Language">
						<PreferredLanguageSetting />
					</FeatureGroup>

					{/* TELEMETRY & PRIVACY */}
					<FeatureGroup isGridItem={false} title="Telemetry & Privacy">
						<Tooltip>
							<TooltipTrigger asChild>
								<div>
									<FeatureItem
										checked={telemetrySetting === "enabled"}
										description={`Help improve Cline by sending usage data and error reports. No code, prompts, or personal information are ever sent.`}
										disabled={remoteConfigSettings?.telemetrySetting === "disabled"}
										label="Allow error and usage reporting"
										onChange={(checked) =>
											updateSetting("telemetrySetting", checked ? "enabled" : "disabled")
										}
									/>
									{!!remoteConfigSettings?.telemetrySetting && (
										<div
											className="mt-2 text-xs flex items-center gap-2"
											style={{ color: "var(--vscode-descriptionForeground)" }}>
											<i className="codicon codicon-lock text-sm" />
											<span>This setting is managed by your organization's remote configuration</span>
										</div>
									)}
								</div>
							</TooltipTrigger>
							<TooltipContent hidden={remoteConfigSettings?.telemetrySetting === undefined}>
								This setting is managed by your organization's remote configuration
							</TooltipContent>
						</Tooltip>

						<div className="mt-2 text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
							See our{" "}
							<VSCodeLink
								href="https://docs.cline.bot/more-info/telemetry"
								style={{ fontSize: "inherit", textDecoration: "underline" }}>
								telemetry overview
							</VSCodeLink>{" "}
							and{" "}
							<VSCodeLink
								href="https://cline.bot/privacy"
								style={{ fontSize: "inherit", textDecoration: "underline" }}>
								privacy policy
							</VSCodeLink>{" "}
							for more details.
						</div>
					</FeatureGroup>
				</div>
			</Section>
		</div>
	)
}

export default GeneralSettingsSection

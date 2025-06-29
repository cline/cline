import { VSCodeCheckbox, VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { ChatSettings } from "@shared/ChatSettings"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import PreferredLanguageSetting from "../PreferredLanguageSetting"
import Section from "../Section"

interface GeneralSettingsSectionProps {
	chatSettings: ChatSettings
	setChatSettings: (settings: ChatSettings) => void
	telemetrySetting: string
	setTelemetrySetting: (value: TelemetrySetting) => void
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const GeneralSettingsSection = ({
	chatSettings,
	setChatSettings,
	telemetrySetting,
	setTelemetrySetting,
	renderSectionHeader,
}: GeneralSettingsSectionProps) => {
	return (
		<div>
			{renderSectionHeader("general")}
			<Section>
				{chatSettings && <PreferredLanguageSetting chatSettings={chatSettings} setChatSettings={setChatSettings} />}

				<div className="mb-[15px]">
					<label htmlFor="userDocumentsPath" style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>
						User Documents Path
					</label>
					<VSCodeTextField
						id="userDocumentsPath"
						className="w-full"
						value={chatSettings?.userDocumentsPath || ""}
						placeholder="~/Documents (default)"
						onChange={(e: any) => {
							const value = e.target.value.trim()
							setChatSettings({
								...chatSettings,
								userDocumentsPath: value || undefined,
							})
						}}
					/>
					<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
						Specify a custom path for Cline's user files (rules, workflows, MCP settings). Leave empty to use the
						default Documents folder.
					</p>
				</div>

				<div className="mb-[5px]">
					<VSCodeCheckbox
						className="mb-[5px]"
						checked={telemetrySetting !== "disabled"}
						onChange={(e: any) => {
							const checked = e.target.checked === true
							setTelemetrySetting(checked ? "enabled" : "disabled")
						}}>
						Allow anonymous error and usage reporting
					</VSCodeCheckbox>
					<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
						Help improve Cline by sending anonymous usage data and error reports. No code, prompts, or personal
						information are ever sent. See our{" "}
						<VSCodeLink href="https://docs.cline.bot/more-info/telemetry" className="text-inherit">
							telemetry overview
						</VSCodeLink>{" "}
						and{" "}
						<VSCodeLink href="https://cline.bot/privacy" className="text-inherit">
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

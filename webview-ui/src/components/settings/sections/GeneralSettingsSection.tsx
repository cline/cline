import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { ChatSettings } from "@shared/ChatSettings"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import PreferredLanguageSetting from "../PreferredLanguageSetting"
import Section from "../Section"
import { useFirebaseAuth } from "../../../context/FirebaseAuthContext"

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
	const { user } = useFirebaseAuth()
	return (
		<div>
			{renderSectionHeader("general")}
			<Section>
				{chatSettings && <PreferredLanguageSetting chatSettings={chatSettings} setChatSettings={setChatSettings} />}

				<div className="mb-[5px]">
					<VSCodeCheckbox
						className="mb-[5px]"
						checked={telemetrySetting !== "disabled"}
						onChange={(e: any) => {
							const checked = e.target.checked === true
							setTelemetrySetting(checked ? "enabled" : "disabled")
						}}>
						Allow error and usage reporting
					</VSCodeCheckbox>
					<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
						{user ? (
							<>
								To help us improve Cline, we collect usage data and associate it with your account. This helps us
								fix bugs and improve the extension.
							</>
						) : (
							<>
								Help improve Cline by sending anonymous usage data and error reports. No code, prompts, or
								personal information are ever sent.
							</>
						)}
						See our{" "}
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

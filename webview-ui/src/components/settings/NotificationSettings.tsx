import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Bell } from "lucide-react"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type NotificationSettingsProps = HTMLAttributes<HTMLDivElement> & {
	ttsEnabled?: boolean
	ttsSpeed?: number
	soundEnabled?: boolean
	soundVolume?: number
	setCachedStateField: SetCachedStateField<"ttsEnabled" | "ttsSpeed" | "soundEnabled" | "soundVolume">
}

export const NotificationSettings = ({
	ttsEnabled,
	ttsSpeed,
	soundEnabled,
	soundVolume,
	setCachedStateField,
	...props
}: NotificationSettingsProps) => {
	const { t } = useAppTranslation()
	return (
		<div {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Bell className="w-4" />
					<div>{t("settings:sections.notifications")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<VSCodeCheckbox
						checked={ttsEnabled}
						onChange={(e: any) => setCachedStateField("ttsEnabled", e.target.checked)}
						data-testid="tts-enabled-checkbox">
						<span className="font-medium">{t("settings:notifications.tts.label")}</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						{t("settings:notifications.tts.description")}
					</p>
					{ttsEnabled && (
						<div className="pl-[10px] ml-0 border-l-2 border-l-vscode-button-background">
							<div className="flex items-center gap-[5px]">
								<input
									type="range"
									min="0.1"
									max="2.0"
									step="0.01"
									value={ttsSpeed ?? 1.0}
									onChange={(e) => setCachedStateField("ttsSpeed", parseFloat(e.target.value))}
									className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
									aria-label="Speed"
									data-testid="tts-speed-slider"
								/>
								<span className="min-w-[35px] text-left">{((ttsSpeed ?? 1.0) * 100).toFixed(0)}%</span>
							</div>
							<p className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:notifications.tts.speedLabel")}
							</p>
						</div>
					)}
				</div>
				<div>
					<VSCodeCheckbox
						checked={soundEnabled}
						onChange={(e: any) => setCachedStateField("soundEnabled", e.target.checked)}
						data-testid="sound-enabled-checkbox">
						<span className="font-medium">{t("settings:notifications.sound.label")}</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						{t("settings:notifications.sound.description")}
					</p>
					{soundEnabled && (
						<div className="pl-[10px] ml-0 border-l-2 border-l-vscode-button-background">
							<div className="flex items-center gap-[5px]">
								<input
									type="range"
									min="0"
									max="1"
									step="0.01"
									value={soundVolume ?? 0.5}
									onChange={(e) => setCachedStateField("soundVolume", parseFloat(e.target.value))}
									className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
									aria-label="Volume"
									data-testid="sound-volume-slider"
								/>
								<span className="min-w-[35px] text-left">
									{((soundVolume ?? 0.5) * 100).toFixed(0)}%
								</span>
							</div>
							<p className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:notifications.sound.volumeLabel")}
							</p>
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}

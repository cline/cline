import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Bell } from "lucide-react"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { Slider } from "../ui"

type NotificationSettingsProps = HTMLAttributes<HTMLDivElement> & {
	ttsEnabled?: boolean
	ttsSpeed?: number
	soundEnabled?: boolean
	soundVolume?: number
	// Desktop notification settings
	desktopNotificationsEnabled?: boolean
	desktopNotificationApprovalRequests?: boolean
	desktopNotificationErrors?: boolean
	desktopNotificationTaskCompletion?: boolean
	desktopNotificationTimeout?: number
	setCachedStateField: SetCachedStateField<
		| "ttsEnabled"
		| "ttsSpeed"
		| "soundEnabled"
		| "soundVolume"
		| "desktopNotificationsEnabled"
		| "desktopNotificationApprovalRequests"
		| "desktopNotificationErrors"
		| "desktopNotificationTaskCompletion"
		| "desktopNotificationTimeout"
	>
}

export const NotificationSettings = ({
	ttsEnabled,
	ttsSpeed,
	soundEnabled,
	soundVolume,
	desktopNotificationsEnabled,
	desktopNotificationApprovalRequests,
	desktopNotificationErrors,
	desktopNotificationTaskCompletion,
	desktopNotificationTimeout,
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
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:notifications.tts.description")}
					</div>
				</div>

				{ttsEnabled && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div>
							<label className="block font-medium mb-1">
								{t("settings:notifications.tts.speedLabel")}
							</label>
							<div className="flex items-center gap-2">
								<Slider
									min={0.1}
									max={2.0}
									step={0.01}
									value={[ttsSpeed ?? 1.0]}
									onValueChange={([value]) => setCachedStateField("ttsSpeed", value)}
									data-testid="tts-speed-slider"
								/>
								<span className="w-10">{((ttsSpeed ?? 1.0) * 100).toFixed(0)}%</span>
							</div>
						</div>
					</div>
				)}

				<div>
					<VSCodeCheckbox
						checked={soundEnabled}
						onChange={(e: any) => setCachedStateField("soundEnabled", e.target.checked)}
						data-testid="sound-enabled-checkbox">
						<span className="font-medium">{t("settings:notifications.sound.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:notifications.sound.description")}
					</div>
				</div>

				{soundEnabled && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div>
							<label className="block font-medium mb-1">
								{t("settings:notifications.sound.volumeLabel")}
							</label>
							<div className="flex items-center gap-2">
								<Slider
									min={0}
									max={1}
									step={0.01}
									value={[soundVolume ?? 0.5]}
									onValueChange={([value]) => setCachedStateField("soundVolume", value)}
									data-testid="sound-volume-slider"
								/>
								<span className="w-10">{((soundVolume ?? 0.5) * 100).toFixed(0)}%</span>
							</div>
						</div>
					</div>
				)}

				<div>
					<VSCodeCheckbox
						checked={desktopNotificationsEnabled}
						onChange={(e: any) => setCachedStateField("desktopNotificationsEnabled", e.target.checked)}
						data-testid="desktop-notifications-enabled-checkbox">
						<span className="font-medium">{t("settings:notifications.desktop.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:notifications.desktop.description")}
					</div>
				</div>

				{desktopNotificationsEnabled && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div>
							<VSCodeCheckbox
								checked={desktopNotificationApprovalRequests}
								onChange={(e: any) => setCachedStateField("desktopNotificationApprovalRequests", e.target.checked)}
								data-testid="desktop-notification-approval-requests-checkbox">
								<span className="font-medium">{t("settings:notifications.desktop.approvalRequests.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:notifications.desktop.approvalRequests.description")}
							</div>
						</div>

						<div>
							<VSCodeCheckbox
								checked={desktopNotificationErrors}
								onChange={(e: any) => setCachedStateField("desktopNotificationErrors", e.target.checked)}
								data-testid="desktop-notification-errors-checkbox">
								<span className="font-medium">{t("settings:notifications.desktop.errors.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:notifications.desktop.errors.description")}
							</div>
						</div>

						<div>
							<VSCodeCheckbox
								checked={desktopNotificationTaskCompletion}
								onChange={(e: any) => setCachedStateField("desktopNotificationTaskCompletion", e.target.checked)}
								data-testid="desktop-notification-task-completion-checkbox">
								<span className="font-medium">{t("settings:notifications.desktop.taskCompletion.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:notifications.desktop.taskCompletion.description")}
							</div>
						</div>

						<div>
							<label className="block font-medium mb-1">
								{t("settings:notifications.desktop.timeout.label")}
							</label>
							<div className="flex items-center gap-2">
								<Slider
									min={0}
									max={60}
									step={1}
									value={[Math.round((desktopNotificationTimeout ?? 10000) / 1000)]}
									onValueChange={([value]) => setCachedStateField("desktopNotificationTimeout", value * 1000)}
									data-testid="desktop-notification-timeout-slider"
								/>
								<span className="w-10">{Math.round((desktopNotificationTimeout ?? 10000) / 1000)}s</span>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:notifications.desktop.timeout.description")}
							</div>
						</div>
					</div>
				)}
			</Section>
		</div>
	)
}

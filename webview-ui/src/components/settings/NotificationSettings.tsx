import { HTMLAttributes } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Bell } from "lucide-react"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type NotificationSettingsProps = HTMLAttributes<HTMLDivElement> & {
	soundEnabled?: boolean
	soundVolume?: number
	setCachedStateField: SetCachedStateField<"soundEnabled" | "soundVolume">
}

export const NotificationSettings = ({
	soundEnabled,
	soundVolume,
	setCachedStateField,
	...props
}: NotificationSettingsProps) => {
	return (
		<div {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Bell className="w-4" />
					<div>Notifications</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<VSCodeCheckbox
						checked={soundEnabled}
						onChange={(e: any) => setCachedStateField("soundEnabled", e.target.checked)}>
						<span className="font-medium">Enable sound effects</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						When enabled, Roo will play sound effects for notifications and events.
					</p>
					{soundEnabled && (
						<div
							style={{
								marginLeft: 0,
								paddingLeft: 10,
								borderLeft: "2px solid var(--vscode-button-background)",
							}}>
							<div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
								<input
									type="range"
									min="0"
									max="1"
									step="0.01"
									value={soundVolume ?? 0.5}
									onChange={(e) => setCachedStateField("soundVolume", parseFloat(e.target.value))}
									className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
									aria-label="Volume"
								/>
								<span style={{ minWidth: "35px", textAlign: "left" }}>
									{((soundVolume ?? 0.5) * 100).toFixed(0)}%
								</span>
							</div>
							<p className="text-vscode-descriptionForeground text-sm mt-1">Volume</p>
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}

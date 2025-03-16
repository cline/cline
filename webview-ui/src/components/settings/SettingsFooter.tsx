import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Trans } from "react-i18next"

import { VSCodeButton, VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import { TelemetrySetting } from "../../../../src/shared/TelemetrySetting"

type SettingsFooterProps = HTMLAttributes<HTMLDivElement> & {
	version: string
	telemetrySetting: TelemetrySetting
	setTelemetrySetting: (setting: TelemetrySetting) => void
}

export const SettingsFooter = ({
	version,
	telemetrySetting,
	setTelemetrySetting,
	className,
	...props
}: SettingsFooterProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("text-vscode-descriptionForeground p-5", className)} {...props}>
			<p style={{ wordWrap: "break-word", margin: 0, padding: 0 }}>
				<Trans
					i18nKey="settings:footer.feedback"
					components={{
						githubLink: <VSCodeLink href="https://github.com/RooVetGit/Roo-Code" />,
						redditLink: <VSCodeLink href="https://reddit.com/r/RooCode" />,
						discordLink: <VSCodeLink href="https://discord.gg/roocode" />,
					}}
				/>
			</p>
			<p className="italic">{t("settings:footer.version", { version })}</p>
			<div className="mt-4 mb-4">
				<div>
					<VSCodeCheckbox
						style={{ marginBottom: "5px" }}
						checked={telemetrySetting === "enabled"}
						onChange={(e: any) => {
							const checked = e.target.checked === true
							setTelemetrySetting(checked ? "enabled" : "disabled")
						}}>
						{t("settings:footer.telemetry.label")}
					</VSCodeCheckbox>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						{t("settings:footer.telemetry.description")}
					</p>
				</div>
			</div>
			<div className="flex justify-between items-center gap-3">
				<p>{t("settings:footer.reset.description")}</p>
				<VSCodeButton
					onClick={() => vscode.postMessage({ type: "resetState" })}
					appearance="secondary"
					className="shrink-0">
					<span className="codicon codicon-warning text-vscode-errorForeground mr-1" />
					{t("settings:footer.reset.button")}
				</VSCodeButton>
			</div>
		</div>
	)
}

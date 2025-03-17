import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Trans } from "react-i18next"
import { Globe } from "lucide-react"

import { VSCodeButton, VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import { TelemetrySetting } from "../../../../src/shared/TelemetrySetting"
import { SetCachedStateField } from "./types"

// Map of language codes to their display names
const LANGUAGES: Record<string, string> = {
	ca: "Català",
	de: "Deutsch",
	en: "English",
	es: "Español",
	fr: "Français",
	hi: "हिन्दी",
	it: "Italiano",
	ja: "日本語",
	ko: "한국어",
	pl: "Polski",
	"pt-BR": "Português",
	tr: "Türkçe",
	vi: "Tiếng Việt",
	"zh-CN": "简体中文",
	"zh-TW": "繁體中文",
}

type SettingsFooterProps = HTMLAttributes<HTMLDivElement> & {
	version: string
	telemetrySetting: TelemetrySetting
	setTelemetrySetting: (setting: TelemetrySetting) => void
	language: string
	setCachedStateField: SetCachedStateField<"language">
}

export const SettingsFooter = ({
	version,
	telemetrySetting,
	setTelemetrySetting,
	language,
	setCachedStateField,
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
			<div className="flex items-center gap-4">
				<div className="flex items-center text-nowrap">
					<p>Roo Code</p>
					<p className="italic ml-1">v{version}</p>
				</div>
				<div className="relative flex items-center">
					<Globe className="w-4 h-4 text-vscode-descriptionForeground absolute left-2 pointer-events-none" />
					<select
						value={language}
						onChange={(e) => setCachedStateField("language", e.target.value)}
						className="appearance-none bg-transparent text-vscode-foreground border border-transparent hover:border-vscode-input-border focus:border-vscode-focusBorder rounded px-2 py-1 pl-7 text-xs min-w-[70px]"
						title={LANGUAGES[language]}>
						{Object.entries(LANGUAGES).map(([code, name]) => (
							<option key={code} value={code}>
								{name} ({code})
							</option>
						))}
					</select>
				</div>
			</div>
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

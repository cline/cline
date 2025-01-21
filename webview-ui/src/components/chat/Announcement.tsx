import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
import { useTranslation } from "react-i18next"
import { Trans } from "react-i18next"

interface AnnouncementProps {
	version: string
	hideAnnouncement: () => void
}

const Announcement = ({ version, hideAnnouncement }: AnnouncementProps) => {
	const { t } = useTranslation("translation", { keyPrefix: "announcement", useSuspense: false })

	const minorVersion = version.split(".").slice(0, 2).join(".") // 2.0.0 -> 2.0
	return (
		<div
			style={{
				backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
				borderRadius: "3px",
				padding: "12px 16px",
				margin: "5px 15px 5px 15px",
				position: "relative",
				flexShrink: 0,
			}}>
			<VSCodeButton appearance="icon" onClick={hideAnnouncement} style={{ position: "absolute", top: "8px", right: "8px" }}>
				<span className="codicon codicon-close"></span>
			</VSCodeButton>
			<h3 style={{ margin: "0 0 8px" }}>{t("newInVersion", { version: minorVersion })}</h3>
			<ul style={{ margin: "0 0 8px", paddingLeft: "12px" }}>
				<li>
					<b>{t("checkpointsTitle")}</b> {t("checkpointsDescription")}
					<ul style={{ margin: "4px 0", paddingLeft: 22 }}>
						<li>
							<span
								className="codicon codicon-diff-multiple"
								style={{
									fontSize: "12px",
									marginRight: "4px",
								}}></span>
							<b>{t("compareTitle")}</b> {t("compareDescription")}
						</li>
						<li>
							<span
								className="codicon codicon-discard"
								style={{
									fontSize: "12px",
									marginRight: "4px",
								}}></span>
							<b>{t("restoreTitle")}</b> {t("restoreDescription")}
						</li>
					</ul>
				</li>
				<li>
					<b>{t("seeNewChangesTitle")}</b> {t("seeNewChangesDescription")}
				</li>
			</ul>
			<p style={{ margin: "8px 0" }}></p>
			<VSCodeLink href="https://x.com/sdrzn/status/1876378124126236949" style={{ display: "inline" }}>
				{t("seeDemo")}
			</VSCodeLink>
			<div
				style={{
					height: "1px",
					background: "var(--vscode-foreground)",
					opacity: 0.1,
					margin: "8px 0",
				}}
			/>
			<p style={{ margin: "0" }}>
				<Trans
					i18nKey="announcement.joinOurCommunities"
					components={{
						DiscordLink: <VSCodeLink href="https://discord.gg/cline" />,
						RedditLink: <VSCodeLink href="https://www.reddit.com/r/cline/" />,
					}}
				/>
			</p>
		</div>
	)
}

export default memo(Announcement)

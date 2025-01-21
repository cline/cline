import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
import { useTranslation } from "react-i18next"
import { Trans } from "react-i18next"

interface AnnouncementProps {
	version: string
	hideAnnouncement: () => void
}

const Announcement = ({ version, hideAnnouncement }: AnnouncementProps) => {
	const { t, ready } = useTranslation("translation", { keyPrefix: "announcement", useSuspense: false })

	const newChangesList = t("newChangesList", { returnObjects: true }) as Array<string>

	const minorVersion = version.split(".").slice(0, 2).join(".") // 2.0.0 -> 2.0
	return (
		ready && (
			<div
				style={{
					backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
					borderRadius: "3px",
					padding: "12px 16px",
					margin: "5px 15px 5px 15px",
					position: "relative",
					flexShrink: 0,
				}}>
				<VSCodeButton
					appearance="icon"
					onClick={hideAnnouncement}
					style={{ position: "absolute", top: "8px", right: "8px" }}>
					<span className="codicon codicon-close"></span>
				</VSCodeButton>
				<h3 style={{ margin: "0 0 8px" }}>{t("newInVersion", { version: minorVersion })}</h3>
				<ul style={{ margin: "0 0 8px", paddingLeft: "12px" }}>
					{newChangesList.map((transcluded, index) => (
						<li>
							<Trans
								components={{
									Link: <VSCodeLink href="#" />,
								}}>
								{transcluded}
							</Trans>
						</li>
					))}
				</ul>
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
	)
}

export default memo(Announcement)

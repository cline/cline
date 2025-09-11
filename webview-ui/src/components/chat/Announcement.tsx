import { useState, memo } from "react"
import { Trans } from "react-i18next"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { Package } from "@roo/package"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@src/components/ui"
import { Button } from "@src/components/ui"

// Define the production URL constant locally to avoid importing from cloud package in webview
const PRODUCTION_ROO_CODE_API_URL = "https://app.roocode.com"

interface AnnouncementProps {
	hideAnnouncement: () => void
}

/**
 * You must update the `latestAnnouncementId` in ClineProvider for new
 * announcements to show to users. This new id will be compared with what's in
 * state for the 'last announcement shown', and if it's different then the
 * announcement will render. As soon as an announcement is shown, the id will be
 * updated in state. This ensures that announcements are not shown more than
 * once, even if the user doesn't close it themselves.
 */

const Announcement = ({ hideAnnouncement }: AnnouncementProps) => {
	const { t } = useAppTranslation()
	const [open, setOpen] = useState(true)
	const { cloudApiUrl } = useExtensionState()
	const cloudUrl = cloudApiUrl || PRODUCTION_ROO_CODE_API_URL

	return (
		<Dialog
			open={open}
			onOpenChange={(open) => {
				setOpen(open)

				if (!open) {
					hideAnnouncement()
				}
			}}>
			<DialogContent className="max-w-96">
				<DialogHeader>
					<DialogTitle>{t("chat:announcement.title", { version: Package.version })}</DialogTitle>
					<DialogDescription>
						<Trans
							i18nKey="chat:announcement.description"
							components={{
								bold: <b />,
							}}
						/>
					</DialogDescription>
				</DialogHeader>
				<div>
					<ul className="space-y-2">
						<li>
							•{" "}
							<Trans
								i18nKey="chat:announcement.feature1"
								components={{
									bold: <b />,
								}}
							/>
						</li>
						<li>
							•{" "}
							<Trans
								i18nKey="chat:announcement.feature2"
								components={{
									bold: <b />,
								}}
							/>
						</li>
					</ul>

					<div className="mt-4">
						<Trans
							i18nKey="chat:announcement.learnMore"
							components={{
								learnMoreLink: (
									<VSCodeLink
										href="https://docs.roocode.com/update-notes/v3.28.0#task-sync--roomote-control"
										onClick={(e) => {
											e.preventDefault()
											window.postMessage(
												{
													type: "action",
													action: "openExternal",
													data: {
														url: "https://docs.roocode.com/update-notes/v3.28.0#task-sync--roomote-control",
													},
												},
												"*",
											)
										}}
									/>
								),
							}}
						/>
					</div>

					<div className="mt-4">
						<Button
							onClick={() => {
								vscode.postMessage({ type: "openExternal", url: cloudUrl })
							}}
							className="w-full">
							{t("chat:announcement.visitCloudButton")}
						</Button>
					</div>

					<div className="mt-4 text-sm text-center">
						<Trans
							i18nKey="chat:announcement.socialLinks"
							components={{
								xLink: <XLink />,
								discordLink: <DiscordLink />,
								redditLink: <RedditLink />,
							}}
						/>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}

const XLink = () => (
	<VSCodeLink
		href="https://x.com/roo_code"
		onClick={(e) => {
			e.preventDefault()
			window.postMessage({ type: "action", action: "openExternal", data: { url: "https://x.com/roo_code" } }, "*")
		}}>
		X
	</VSCodeLink>
)

const DiscordLink = () => (
	<VSCodeLink
		href="https://discord.gg/rCQcvT7Fnt"
		onClick={(e) => {
			e.preventDefault()
			window.postMessage(
				{ type: "action", action: "openExternal", data: { url: "https://discord.gg/rCQcvT7Fnt" } },
				"*",
			)
		}}>
		Discord
	</VSCodeLink>
)

const RedditLink = () => (
	<VSCodeLink
		href="https://www.reddit.com/r/RooCode/"
		onClick={(e) => {
			e.preventDefault()
			window.postMessage(
				{ type: "action", action: "openExternal", data: { url: "https://www.reddit.com/r/RooCode/" } },
				"*",
			)
		}}>
		r/RooCode
	</VSCodeLink>
)

export default memo(Announcement)

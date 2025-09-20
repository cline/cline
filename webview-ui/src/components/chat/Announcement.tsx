import { useState, memo } from "react"
import { Trans } from "react-i18next"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { Package } from "@roo/package"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@src/components/ui"
import { Button } from "@src/components/ui"

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
	const { cloudIsAuthenticated } = useExtensionState()

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
				</DialogHeader>
				<div>
					<div className="mb-3">
						<Trans
							i18nKey="chat:announcement.stealthModel.feature"
							components={{
								bold: <b />,
							}}
						/>
					</div>

					<p className="mt-3 text-sm text-vscode-descriptionForeground">
						{t("chat:announcement.stealthModel.note")}
					</p>

					<div className="mt-4">
						{!cloudIsAuthenticated ? (
							<Button
								onClick={() => {
									vscode.postMessage({
										type: "cloudLandingPageSignIn",
										text: "supernova",
									})
								}}
								className="w-full">
								{t("chat:announcement.stealthModel.connectButton")}
							</Button>
						) : (
							<>
								<p className="mb-3">
									<Trans
										i18nKey="chat:announcement.stealthModel.selectModel"
										components={{
											code: <code />,
										}}
									/>
								</p>
								<Button
									onClick={() => {
										setOpen(false)
										hideAnnouncement()
										vscode.postMessage({
											type: "switchTab",
											tab: "settings",
										})
									}}
									className="w-full">
									{t("chat:announcement.stealthModel.goToSettingsButton")}
								</Button>
							</>
						)}
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
			vscode.postMessage({ type: "openExternal", url: "https://x.com/roo_code" })
		}}>
		X
	</VSCodeLink>
)

const DiscordLink = () => (
	<VSCodeLink
		href="https://discord.gg/rCQcvT7Fnt"
		onClick={(e) => {
			e.preventDefault()
			vscode.postMessage({ type: "openExternal", url: "https://discord.gg/rCQcvT7Fnt" })
		}}>
		Discord
	</VSCodeLink>
)

const RedditLink = () => (
	<VSCodeLink
		href="https://www.reddit.com/r/RooCode/"
		onClick={(e) => {
			e.preventDefault()
			vscode.postMessage({ type: "openExternal", url: "https://www.reddit.com/r/RooCode/" })
		}}>
		r/RooCode
	</VSCodeLink>
)

export default memo(Announcement)

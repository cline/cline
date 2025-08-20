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
					<ul className="space-y-2">
						<li>
							•{" "}
							<Trans
								i18nKey="chat:announcement.stealthModel.feature"
								components={{
									bold: <b />,
								}}
							/>
						</li>
					</ul>

					<p className="text-xs text-muted-foreground mt-2">{t("chat:announcement.stealthModel.note")}</p>

					<div className="mt-4">
						{!cloudIsAuthenticated ? (
							<Button
								onClick={() => {
									vscode.postMessage({ type: "rooCloudSignIn" })
								}}
								className="w-full">
								{t("chat:announcement.stealthModel.connectButton")}
							</Button>
						) : (
							<div className="text-sm w-full">
								<Trans
									i18nKey="chat:announcement.stealthModel.selectModel"
									components={{
										code: <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded" />,
										settingsLink: (
											<VSCodeLink
												href="#"
												onClick={(e) => {
													e.preventDefault()
													setOpen(false)
													hideAnnouncement()
													window.postMessage(
														{
															type: "action",
															action: "settingsButtonClicked",
															values: { section: "provider" },
														},
														"*",
													)
												}}
											/>
										),
									}}
								/>
							</div>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}

export default memo(Announcement)

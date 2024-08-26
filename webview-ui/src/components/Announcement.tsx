import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { ApiConfiguration } from "../../../src/shared/api"
import { getKoduSignInUrl } from "../../../src/shared/kodu"
import VSCodeButtonLink from "./VSCodeButtonLink"

interface AnnouncementProps {
	version: string
	hideAnnouncement: () => void
	apiConfiguration?: ApiConfiguration
	vscodeUriScheme?: string
}
/*
You must update the latestAnnouncementId in ClaudeDevProvider for new announcements to show to users. This new id will be compared with whats in state for the 'last announcement shown', and if it's different then the announcement will render. As soon as an announcement is shown, the id will be updated in state. This ensures that announcements are not shown more than once, even if the user doesn't close it themselves.
*/
const Announcement = ({ version, hideAnnouncement, apiConfiguration, vscodeUriScheme }: AnnouncementProps) => {
	return (
		<div
			style={{
				backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
				borderRadius: "3px",
				padding: "12px 16px",
				margin: "5px 15px 5px 15px",
				position: "relative",
			}}>
			<VSCodeButton
				appearance="icon"
				onClick={hideAnnouncement}
				style={{ position: "absolute", top: "8px", right: "8px" }}>
				<span className="codicon codicon-close"></span>
			</VSCodeButton>
			<h3 style={{ margin: "0 0 8px" }}>
				🎉{"  "}New in v{version}
			</h3>

			<ul style={{ margin: "0 0 8px", paddingLeft: "12px" }}>
				<li>
					Excited to announce that we've partnered with Anthropic and are offering <b>$20 free credits</b> to
					help users get the most out of Claude Dev with increased rate limits and prompt caching! Stay tuned
					for some exciting updates like easier billing, voice mode and one click deployment!
					{apiConfiguration?.koduApiKey === undefined && (
						<VSCodeButtonLink
							appearance="secondary"
							href={getKoduSignInUrl(vscodeUriScheme)}
							style={{
								transform: "scale(0.85)",
								transformOrigin: "left center",
								margin: "4px -30px 2px 0",
							}}>
							Claim $20 Credits on Kodu
						</VSCodeButtonLink>
					)}
				</li>
				<li>
					Added "Always allow read-only operations" setting to let Claude read files and view directories
					without needing to approve (off by default).
				</li>
				<li>Added sliding window context management to keep tasks going past 200k tokens.</li>
			</ul>
			<p style={{ margin: "0" }}>
				Follow me for more updates!{" "}
				<VSCodeLink href="https://x.com/sdrzn" style={{ display: "inline" }}>
					@sdrzn
				</VSCodeLink>
			</p>
		</div>
	)
}

export default Announcement

import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

interface AnnouncementProps {
	version: string
	hideAnnouncement: () => void
}
/*
You must update the latestAnnouncementId in ClaudeDevProvider for new announcements to show to users. This new id will be compared with whats in state for the 'last announcement shown', and if it's different then the announcement will render. As soon as an announcement is shown, the id will be updated in state. This ensures that announcements are not shown more than once, even if the user doesn't close it themselves.
*/
const Announcement = ({ version, hideAnnouncement }: AnnouncementProps) => {
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
			<ul style={{ margin: "0 0 8px", paddingLeft: "20px" }}>
				<li>Task history is here! New tasks will automatically save so you can always resume them later.</li>
				<li>
					Adds support for{" "}
					<VSCodeLink href="https://www.anthropic.com/news/prompt-caching" style={{ display: "inline" }}>
						Prompt Caching
					</VSCodeLink>{" "}
					to reduce costs by up to 90% and latency by up to 85% (currently only available through Anthropic
					API for Claude 3.5 Sonnet and Claude 3.0 Haiku)
				</li>
				<li>
					Paste images in chat and turn mockups into fully functional applications or fix bugs with
					screenshots
				</li>
				<li>
					You can now add custom instructions to the end of the system prompt (e.g. "Always use Python",
					"Speak in Spanish")
				</li>
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

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
				<li>
					Paste images in chat to use Claude's vision capabilities and turn mockups into fully functional
					applications or fix bugs with screenshots
				</li>
				<li>
					Added a settings option to choose other Claude models (+ GPT-4o, DeepSeek, and Mistral if you use
					OpenRouter)
				</li>
				<li>
					You can now add custom instructions to the end of the system prompt (e.g. "Always use Python",
					"Speak in Spanish")
				</li>
				<li>
					Improved support for running interactive terminal commands and long-running processes like servers
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

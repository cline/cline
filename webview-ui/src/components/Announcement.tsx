import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

interface AnnouncementProps {
	hideAnnouncement: () => void
}
/*
You must update the latestAnnouncementId in ClaudeDevProvider for new announcements to show to users. This new id will be compared with whats in state for the 'last announcement shown', and if it's different then the announcement will render. As soon as an announcement is shown, the id will be updated in state. This ensures that announcements are not shown more than once, even if the user doesn't close it themselves.
*/
const Announcement = ({ hideAnnouncement }: AnnouncementProps) => {
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
			<h3 style={{ margin: "0 0 8px" }}>🎉{"  "}New in v1.0.0</h3>
			<ul style={{ margin: "0 0 8px", paddingLeft: "20px" }}>
				<li>
					Open in the editor (using{" "}
					<span
						className="codicon codicon-link-external"
						style={{ display: "inline", fontSize: "12.5px", verticalAlign: "text-bottom" }}></span>{" "}
					or <code>Claude Dev: Open In New Tab</code> in command palette) to see how Claude updates your
					workspace more clearly
				</li>
				<li>
					New <code>analyze_project</code> tool to help Claude get a comprehensive overview of your project's
					source code definitions and file structure
				</li>
				<li>Provide feedback to tool use like terminal commands and file edits</li>
				<li>
					Updated max output tokens to 8192 so less lazy coding (<code>{"// rest of code here..."}</code>)
				</li>
				<li>Added ability to retry failed API requests (helpful for rate limits)</li>
				<li>
					Quality of life improvements like markdown rendering, memory optimizations, better theme support
				</li>
			</ul>
			<p style={{ margin: "0" }}>
				Subscribe to my new YouTube to see how to get the most out of Claude Dev!{" "}
				<VSCodeLink href="https://youtube.com/@saoudrizwan" style={{ display: "inline" }}>
					https://youtube.com/@saoudrizwan
				</VSCodeLink>
			</p>
		</div>
	)
}

export default Announcement

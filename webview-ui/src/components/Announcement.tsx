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
			<h3 style={{ margin: "0 0 8px" }}>🎉{"  "}New in v1.0.87</h3>
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
					New <code style={{ wordBreak: "break-all" }}>list_files_recursive</code> and{" "}
					<code style={{ wordBreak: "break-all" }}>view_source_code_definitions_top_level</code> tools to help
					Claude get a comprehensive overview of your project's file structure and source code definitions
					<VSCodeLink
						href="https://github.com/saoudrizwan/claude-dev?tab=readme-ov-file#working-in-existing-projects"
						style={{ display: "inline" }}>
						(more on this here)
					</VSCodeLink>
				</li>
				<li>
					Interact with CLI commands by sending messages to stdin and terminating long-running processes like
					servers
				</li>
				<li>Provide feedback to tool use like editing files or running commands</li>
				<li>Shows diff view of new or edited files right in the editor</li>
				<li>Added ability to retry failed API requests (helpful for rate limits)</li>
				<li>Export task to a markdown file (useful as context for future tasks)</li>
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

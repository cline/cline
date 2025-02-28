import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"

interface AnnouncementProps {
	version: string
	hideAnnouncement: () => void
}
/*
You must update the latestAnnouncementId in ClineProvider for new announcements to show to users. This new id will be compared with whats in state for the 'last announcement shown', and if it's different then the announcement will render. As soon as an announcement is shown, the id will be updated in state. This ensures that announcements are not shown more than once, even if the user doesn't close it themselves.
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
				flexShrink: 0,
			}}>
			<VSCodeButton
				appearance="icon"
				onClick={hideAnnouncement}
				title="Hide announcement"
				style={{ position: "absolute", top: "8px", right: "8px" }}>
				<span className="codicon codicon-close"></span>
			</VSCodeButton>
			<h2 style={{ margin: "0 0 8px" }}>🎉{"  "}Automatic Checkpoints Now Enabled</h2>

			<p style={{ margin: "5px 0px" }}>
				We're thrilled to announce that our experimental Checkpoints feature is now enabled by default for all
				users. This powerful feature automatically tracks your project changes during a task, allowing you to
				quickly review or revert to earlier states if needed.
			</p>

			<h3 style={{ margin: "12px 0 8px" }}>What's New</h3>
			<p style={{ margin: "5px 0px" }}>
				Automatic Checkpoints provide you with:
				<ul style={{ margin: "4px 0 6px 20px", padding: 0 }}>
					<li>Peace of mind when making significant changes</li>
					<li>Ability to visually inspect changes between steps</li>
					<li>Easy rollback if you're not satisfied with certain code modifications</li>
					<li>Improved navigation through complex task execution</li>
				</ul>
			</p>

			<h3 style={{ margin: "12px 0 8px" }}>Customize Your Experience</h3>
			<p style={{ margin: "5px 0px" }}>
				While we recommend keeping this feature enabled, you can disable it if needed.{" "}
				<VSCodeLink
					href="#"
					onClick={(e) => {
						e.preventDefault()
						window.postMessage({ type: "action", action: "settingsButtonClicked" }, "*")
					}}
					style={{ display: "inline", padding: "0 2px" }}>
					Open Settings
				</VSCodeLink>{" "}
				and look for the "Enable automatic checkpoints" option in the Advanced Settings section.
			</p>
		</div>
	)
}

export default memo(Announcement)

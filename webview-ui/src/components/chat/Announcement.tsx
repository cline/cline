import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
// import VSCodeButtonLink from "./VSCodeButtonLink"
// import { getOpenRouterAuthUrl } from "./ApiOptions"
// import { vscode } from "../utils/vscode"

interface AnnouncementProps {
	version: string
	hideAnnouncement: () => void
}
/*
You must update the latestAnnouncementId in ClineProvider for new announcements to show to users. This new id will be compared with whats in state for the 'last announcement shown', and if it's different then the announcement will render. As soon as an announcement is shown, the id will be updated in state. This ensures that announcements are not shown more than once, even if the user doesn't close it themselves.
*/
const Announcement = ({ version, hideAnnouncement }: AnnouncementProps) => {
	const minorVersion = version.split(".").slice(0, 2).join(".") // 2.0.0 -> 2.0
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
			<VSCodeButton appearance="icon" onClick={hideAnnouncement} style={{ position: "absolute", top: "8px", right: "8px" }}>
				<span className="codicon codicon-close"></span>
			</VSCodeButton>
			<h3 style={{ margin: "0 0 8px" }}>
				🎉{"  "}New in v{minorVersion}
			</h3>
			<ul style={{ margin: "0 0 8px", paddingLeft: "12px" }}>
				<li>
					<b>Checkpoints are here!</b> OG Assistant now saves a snapshot of your workspace at each step of the task.
					Hover over any message to see two new buttons:
					<ul style={{ margin: "4px 0", paddingLeft: 22 }}>
						<li>
							<span
								className="codicon codicon-diff-multiple"
								style={{
									fontSize: "12px",
									marginRight: "4px",
								}}></span>
							<b>Compare</b> shows you a diff between the snapshot and your current workspace
						</li>
						<li>
							<span
								className="codicon codicon-discard"
								style={{
									fontSize: "12px",
									marginRight: "4px",
								}}></span>
							<b>Restore</b> lets you revert your project's files back to that point in the task
						</li>
					</ul>
				</li>
				<li>
					<b>'See new changes' button</b> when a task is completed, showing you an overview of all the changes OG
					Assistant made to your workspace throughout the task
				</li>
			</ul>
			<p style={{ margin: "8px 0" }}>
				<VSCodeLink href="https://x.com/sdrzn/status/1876378124126236949" style={{ display: "inline" }}>
					See a demo of Checkpoints here!
				</VSCodeLink>
			</p>
			<div
				style={{
					height: "1px",
					background: "var(--vscode-foreground)",
					opacity: 0.1,
					margin: "8px 0",
				}}
			/>
		</div>
	)
}

export default memo(Announcement)

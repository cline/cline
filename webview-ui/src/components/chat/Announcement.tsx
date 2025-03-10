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
			<h2 style={{ margin: "0 0 8px" }}>🎉{"  "}Roo Code 3.8 Released</h2>

			<p style={{ margin: "5px 0px" }}>
				Roo Code 3.8 is out with performance boosts, new features, and bug fixes.
			</p>

			<h3 style={{ margin: "12px 0 8px" }}>What's New</h3>
			<div style={{ margin: "5px 0px" }}>
				<ul style={{ margin: "4px 0 6px 20px", padding: 0 }}>
					<li>• Faster asynchronous checkpoints</li>
					<li>• Support for .rooignore files</li>
					<li>• Fixed terminal & gray screen issues</li>
					<li>• Roo Code can run in multiple windows</li>
					<li>• Experimental multi-diff editing strategy</li>
					<li>• Subtask to parent task communication</li>
					<li>• Updated DeepSeek provider</li>
					<li>• New "Human Relay" provider</li>
				</ul>
			</div>

			<p style={{ margin: "10px 0px 0px" }}>
				Get more details and discuss in{" "}
				<VSCodeLink
					href="https://discord.gg/roocode"
					onClick={(e) => {
						e.preventDefault()
						window.postMessage(
							{ type: "action", action: "openExternal", data: { url: "https://discord.gg/roocode" } },
							"*",
						)
					}}>
					Discord
				</VSCodeLink>{" "}
				and{" "}
				<VSCodeLink
					href="https://reddit.com/r/RooCode"
					onClick={(e) => {
						e.preventDefault()
						window.postMessage(
							{ type: "action", action: "openExternal", data: { url: "https://reddit.com/r/RooCode" } },
							"*",
						)
					}}>
					Reddit
				</VSCodeLink>{" "}
				🚀
			</p>
		</div>
	)
}

export default memo(Announcement)

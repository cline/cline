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
	// const minorVersion = version.split(".").slice(0, 2).join(".") // 2.0.0 -> 2.0
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
				style={{ position: "absolute", top: "8px", right: "8px" }}>
				<span className="codicon codicon-close"></span>
			</VSCodeButton>
			<h2 style={{ margin: "0 0 8px" }}>🎉{"  "}Introducing Roo Code 4.0</h2>

			<p style={{ margin: "5px 0px" }}>
				Our biggest update yet is here - we're officially changing our name from "Roo Cline" to "Roo Code"!
				After growing beyond 50,000 installations, we're ready to chart our own course. Our heartfelt thanks to
				everyone in the Cline community who helped us reach this milestone.
			</p>

			<h3 style={{ margin: "12px 0 8px" }}>Custom Modes: Celebrating Our New Identity</h3>
			<p style={{ margin: "5px 0px" }}>
				To mark this new chapter, we're introducing the power to shape Roo Code into any role you need! Create
				specialized personas and create an entire team of agents with deeply customized prompts:
				<ul style={{ margin: "4px 0 6px 20px", padding: 0 }}>
					<li>QA Engineers who write thorough test cases and catch edge cases</li>
					<li>Product Managers who excel at user stories and feature prioritization</li>
					<li>UI/UX Designers who craft beautiful, accessible interfaces</li>
					<li>Code Reviewers who ensure quality and maintainability</li>
				</ul>
				Just click the <span className="codicon codicon-notebook" style={{ fontSize: "10px" }}></span> icon to
				get started with Custom Modes!
			</p>

			<h3 style={{ margin: "12px 0 8px" }}>Join Us for the Next Chapter</h3>
			<p style={{ margin: "5px 0px" }}>
				We can't wait to see how you'll push Roo Code's potential even further! Share your custom modes and join
				the discussion at{" "}
				<VSCodeLink href="https://www.reddit.com/r/RooCode" style={{ display: "inline" }}>
					reddit.com/r/RooCode
				</VSCodeLink>
				.
			</p>
		</div>
	)
}

export default memo(Announcement)

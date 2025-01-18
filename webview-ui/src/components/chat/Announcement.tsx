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
			<VSCodeButton
				appearance="icon"
				onClick={hideAnnouncement}
				style={{ position: "absolute", top: "8px", right: "8px" }}>
				<span className="codicon codicon-close"></span>
			</VSCodeButton>
			<h2 style={{ margin: "0 0 8px" }}>
				🎉{"  "}Introducing Roo Cline v{minorVersion}
			</h2>

			<h3 style={{ margin: "0 0 8px" }}>Agent Modes Customization</h3>
			<p style={{ margin: "5px 0px" }}>
				Click the new <span className="codicon codicon-notebook" style={{ fontSize: "10px" }}></span> icon in
				the menu bar to open the Prompts Settings and customize Agent Modes for new levels of productivity.
				<ul style={{ margin: "4px 0 6px 20px", padding: 0 }}>
					<li>Tailor how Roo Cline behaves in different modes: Code, Architect, and Ask.</li>
					<li>Preview and verify your changes using the Preview System Prompt button.</li>
				</ul>
			</p>

			<h3 style={{ margin: "0 0 8px" }}>Prompt Enhancement Configuration</h3>
			<p style={{ margin: "5px 0px" }}>
				Now available for all providers! Access it directly in the chat box by clicking the{" "}
				<span className="codicon codicon-sparkle" style={{ fontSize: "10px" }}></span> sparkle icon next to the
				input field. From there, you can customize the enhancement logic and provider to best suit your
				workflow.
				<ul style={{ margin: "4px 0 6px 20px", padding: 0 }}>
					<li>Customize how prompts are enhanced for better results in your workflow.</li>
					<li>
						Use the sparkle icon in the chat box to select a API configuration and provider (e.g., GPT-4)
						and configure your own enhancement logic.
					</li>
					<li>Test your changes instantly with the Preview Prompt Enhancement tool.</li>
				</ul>
			</p>

			<p style={{ margin: "5px 0px" }}>
				We're very excited to see what you build with this new feature! Join us at
				<VSCodeLink href="https://www.reddit.com/r/roocline" style={{ display: "inline" }}>
					reddit.com/r/roocline
				</VSCodeLink>
				to discuss and share feedback.
			</p>
		</div>
	)
}

export default memo(Announcement)

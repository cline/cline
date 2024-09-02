import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { ApiConfiguration } from "../../../src/shared/api"

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
					New terminal emulator! When Claude runs commands, you can now type directly in the terminal (+
					support for Python environments)
				</li>
				<li>
					<b>You can now edit Claude's changes before accepting!</b> When he edits or creates a file, you can
					modify his changes directly in the right side of the diff view (+ hover over the 'Revert Block'
					arrow button in the center to undo "<code>{"// rest of code here"}</code>" shenanigans)
				</li>
				<li>
					Adds support for reading .pdf and .docx files (try "turn my business_plan.docx into a company
					website")
				</li>
				<li>
					Adds new <code>search_files</code> tool that lets Claude perform regex searches in your project,
					making it easy for him to refactor code, address TODOs and FIXMEs, remove dead code, and more!
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

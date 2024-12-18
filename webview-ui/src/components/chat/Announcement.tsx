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
			<h3 style={{ margin: "0 0 8px" }}>
				🎉{"  "}New in v{minorVersion}
			</h3>
			<ul style={{ margin: "0 0 8px", paddingLeft: "12px" }}>
				<li>
					<b>Auto-approve menu:</b> You can now specify which tools require approval, set a max # of
					auto-approved API requests, and enable system notifications for when Cline completes a task.
				</li>
				<li>
					<b>New diff editing for large files:</b> Cline now uses an efficient search & replace approach when
					modifying large files for faster, more reliable edits (no more "
					<code>{"// rest of code here"}</code>" deletions).
				</li>
				<li>
					<b>.clinerules:</b> Add a root-level <code>.clinerules</code> file to specify custom instructions
					for the project.
				</li>
			</ul>
			<p style={{ margin: "5px 0px", fontWeight: "bold" }}>v2.2 Updates:</p>
			<ul style={{ margin: "0 0 8px", paddingLeft: "12px" }}>
				<li>
					Add and configure{" "}
					<VSCodeLink href="https://github.com/modelcontextprotocol/servers" style={{ display: "inline" }}>
						MCP servers
					</VSCodeLink>
					by clicking the new <span className="codicon codicon-server" style={{ fontSize: "10px" }}></span>{" "}
					icon in the menu bar.
				</li>
				<li>
					Cline can also create custom tools–just say "add a tool that...", and watch him create the MCP
					server and install it in the extension, ready to use in future tasks.
				</li>
				<li>
					Try it yourself by asking Cline to "add a tool that gets the latest npm docs", or
					<VSCodeLink href="https://x.com/sdrzn/status/1867271665086074969" style={{ display: "inline" }}>
						see a demo of MCP in action here.
					</VSCodeLink>
				</li>
			</ul>
			{/*<ul style={{ margin: "0 0 8px", paddingLeft: "12px" }}>
				 <li>
					OpenRouter now supports prompt caching! They also have much higher rate limits than other providers,
					so I recommend trying them out.
					<br />
					{!apiConfiguration?.openRouterApiKey && (
						<VSCodeButtonLink
							href={getOpenRouterAuthUrl(vscodeUriScheme)}
							style={{
								transform: "scale(0.85)",
								transformOrigin: "left center",
								margin: "4px -30px 2px 0",
							}}>
							Get OpenRouter API Key
						</VSCodeButtonLink>
					)}
					{apiConfiguration?.openRouterApiKey && apiConfiguration?.apiProvider !== "openrouter" && (
						<VSCodeButton
							onClick={() => {
								vscode.postMessage({
									type: "apiConfiguration",
									apiConfiguration: { ...apiConfiguration, apiProvider: "openrouter" },
								})
							}}
							style={{
								transform: "scale(0.85)",
								transformOrigin: "left center",
								margin: "4px -30px 2px 0",
							}}>
							Switch to OpenRouter
						</VSCodeButton>
					)}
				</li> 
				<li>
					<b>Edit Cline's changes before accepting!</b> When he creates or edits a file, you can modify his
					changes directly in the right side of the diff view (+ hover over the 'Revert Block' arrow button in
					the center to undo "<code>{"// rest of code here"}</code>" shenanigans)
				</li>
				<li>
					New <code>search_files</code> tool that lets Cline perform regex searches in your project, letting
					him refactor code, address TODOs and FIXMEs, remove dead code, and more!
				</li>
				<li>
					When Cline runs commands, you can now type directly in the terminal (+ support for Python
					environments)
				</li>
			</ul>*/}
			<div
				style={{
					height: "1px",
					background: "var(--vscode-foreground)",
					opacity: 0.1,
					margin: "8px 0",
				}}
			/>
			<p style={{ margin: "0" }}>
				Join
				<VSCodeLink style={{ display: "inline" }} href="https://discord.gg/cline">
					discord.gg/cline
				</VSCodeLink>
				for more updates!
			</p>
		</div>
	)
}

export default memo(Announcement)

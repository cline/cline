import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND, VSC_INACTIVE_SELECTION_BACKGROUND } from "../../utils/vscStyles"
import { vscode } from "../../utils/vscode"

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
				backgroundColor: getAsVar(VSC_INACTIVE_SELECTION_BACKGROUND),
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
					<b>Introducing MCP Marketplace:</b> Discover and install the best MCP servers right from the extension, with
					new servers added regularly! Get started by going to the{" "}
					<span className="codicon codicon-extensions" style={{ marginRight: "4px", fontSize: 10 }}></span>
					<VSCodeLink
						onClick={() => {
							vscode.postMessage({ type: "showMcpView" })
						}}>
						MCP Servers tab
					</VSCodeLink>
					.
				</li>
				<li>
					<b>Mermaid diagrams in Plan mode!</b> Cline can now visualize his plans using flowcharts, sequences,
					entity-relationships, and more. When he explains his approach using mermaid, you'll see a diagram right in
					chat that you can click to expand.
				</li>
				<li>
					Use <code>@terminal</code> to reference terminal contents, and <code>@git</code> to reference working changes
					and commits!
				</li>
				<li>
					New visual indicator for checkpoints after edits & commands, and automatic checkpoint at the start of each
					task.
				</li>
			</ul>
			<VSCodeLink href="https://x.com/sdrzn/status/1892262424881090721" style={{ display: "inline" }}>
				See a demo of the changes here!
			</VSCodeLink>
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
					background: getAsVar(VSC_DESCRIPTION_FOREGROUND),
					opacity: 0.1,
					margin: "8px 0",
				}}
			/>
			<p style={{ margin: "0" }}>
				Join us on{" "}
				<VSCodeLink style={{ display: "inline" }} href="https://x.com/cline">
					X,
				</VSCodeLink>{" "}
				<VSCodeLink style={{ display: "inline" }} href="https://discord.gg/cline">
					discord,
				</VSCodeLink>{" "}
				or{" "}
				<VSCodeLink style={{ display: "inline" }} href="https://www.reddit.com/r/cline/">
					r/cline
				</VSCodeLink>
				for more updates!
			</p>
		</div>
	)
}

export default memo(Announcement)

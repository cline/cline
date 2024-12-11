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
			<p style={{ margin: "5px 0px", fontWeight: "bold" }}>Add custom tools to Cline using MCP!</p>
			<p style={{ margin: "5px 0px" }}>
				The Model Context Protocol allows agents like Cline to plug and play custom tools,{" "}
				<VSCodeLink href="https://github.com/modelcontextprotocol/servers" style={{ display: "inline" }}>
					e.g. a web-search tool or GitHub tool.
				</VSCodeLink>
			</p>
			<p style={{ margin: "5px 0px" }}>
				You can add and configure MCP servers by clicking the{" "}
				<span className="codicon codicon-server" style={{ fontSize: "10px" }}></span> icon in the menu bar.
			</p>
			<p style={{ margin: "5px 0px" }}>
				To take things a step further, Cline also has the ability to create custom tools for himself. Just say
				"add a tool that..." and watch as he builds and installs new capabilities specific to{" "}
				<i>your workflow</i>. For example:
				<ul style={{ margin: "4px 0 6px 20px", padding: 0 }}>
					<li>"...fetches Jira tickets": Get ticket ACs and put Cline to work</li>
					<li>"...manages AWS EC2s": Check server metrics and scale up or down</li>
					<li>"...pulls PagerDuty incidents": Pulls details to help Cline fix bugs</li>
				</ul>
				Cline handles everything from creating the MCP server to installing it in the extension, ready to use in
				future tasks. The servers are saved to <code>~/Documents/Cline/MCP</code> so you can easily share them
				with others too.{" "}
			</p>
			<p style={{ margin: "5px 0px" }}>
				<VSCodeLink href="https://x.com/sdrzn/status/1850880547825823989" style={{ display: "inline" }}>
					See a demo of MCP in action here!
				</VSCodeLink>
			</p>
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

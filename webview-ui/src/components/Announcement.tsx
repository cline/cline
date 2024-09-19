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
You must update the latestAnnouncementId in ClaudeDevProvider for new announcements to show to users. This new id will be compared with whats in state for the 'last announcement shown', and if it's different then the announcement will render. As soon as an announcement is shown, the id will be updated in state. This ensures that announcements are not shown more than once, even if the user doesn't close it themselves.
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
				style={{ position: "absolute", top: "8px", right: "8px" }}>
				<span className="codicon codicon-close"></span>
			</VSCodeButton>
			<h3 style={{ margin: "0 0 8px" }}>
				🎉{"  "}New in v{version}
			</h3>
			<p style={{ margin: "5px 0px" }}>You can now use '@' in the textarea to add context!</p>
			<ul style={{ margin: "0 0 8px", paddingLeft: "12px" }}>
				<li>
					<strong>@url:</strong> Paste in a URL for the extension to fetch and convert to markdown, useful
					when you want to give Claude the latest docs!
				</li>
				<li>
					<strong>@problems:</strong> Add workspace errors and warnings for Claude to fix, no more
					back-and-forth about debugging
				</li>
				<li>
					<strong>@file:</strong> Adds a file's contents so you don't have to waste an API request approving a
					read file (+ type to search files)
				</li>
				<li>
					<strong>@folder:</strong> Adds folder's files all at once to speed up your workflow even more
				</li>
			</ul>
			{/* <p style={{ margin: "5px 0px" }}>
				Claude can now monitor workspace problems to keep updated on linter/compiler/build issues, letting him
				proactively fix errors on his own! (adding missing imports, fixing type errors, etc.)
				<VSCodeLink style={{ display: "inline" }} href="https://x.com/sdrzn/status/1835100787275419829">
					See a demo here.
				</VSCodeLink>
			</p> */}
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
					<b>Edit Claude's changes before accepting!</b> When he creates or edits a file, you can modify his
					changes directly in the right side of the diff view (+ hover over the 'Revert Block' arrow button in
					the center to undo "<code>{"// rest of code here"}</code>" shenanigans)
				</li>
				<li>
					New <code>search_files</code> tool that lets Claude perform regex searches in your project, letting
					him refactor code, address TODOs and FIXMEs, remove dead code, and more!
				</li>
				<li>
					When Claude runs commands, you can now type directly in the terminal (+ support for Python
					environments)
				</li>
			</ul>*/}
			<p style={{ margin: "0" }}>
				Follow me for more updates!{" "}
				<VSCodeLink href="https://x.com/sdrzn" style={{ display: "inline" }}>
					@sdrzn
				</VSCodeLink>
			</p>
		</div>
	)
}

export default memo(Announcement)

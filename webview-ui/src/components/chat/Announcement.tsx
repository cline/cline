import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { CSSProperties, memo } from "react"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND, VSC_INACTIVE_SELECTION_BACKGROUND } from "@/utils/vscStyles"
import { Accordion, AccordionItem } from "@heroui/react"

interface AnnouncementProps {
	version: string
	hideAnnouncement: () => void
}

const containerStyle: CSSProperties = {
	backgroundColor: getAsVar(VSC_INACTIVE_SELECTION_BACKGROUND),
	borderRadius: "3px",
	padding: "12px 16px",
	margin: "5px 15px 5px 15px",
	position: "relative",
	flexShrink: 0,
}
const closeIconStyle: CSSProperties = { position: "absolute", top: "8px", right: "8px" }
const h3TitleStyle: CSSProperties = { margin: "0 0 8px" }
const ulStyle: CSSProperties = { margin: "0 0 8px", paddingLeft: "12px" }
const accountIconStyle: CSSProperties = { fontSize: 11 }
const hrStyle: CSSProperties = {
	height: "1px",
	background: getAsVar(VSC_DESCRIPTION_FOREGROUND),
	opacity: 0.1,
	margin: "8px 0",
}
const linkContainerStyle: CSSProperties = { margin: "0" }
const linkStyle: CSSProperties = { display: "inline" }

/*
Announcements are automatically shown when the major.minor version changes (for ex 3.19.x → 3.20.x or 4.0.x). 
The latestAnnouncementId is now automatically generated from the extension's package.json version. 
Patch releases (3.19.1 → 3.19.2) will not trigger new announcements.
*/
const Announcement = ({ version, hideAnnouncement }: AnnouncementProps) => {
	const minorVersion = version.split(".").slice(0, 2).join(".") // 2.0.0 -> 2.0
	return (
		<div style={containerStyle}>
			<VSCodeButton data-testid="close-button" appearance="icon" onClick={hideAnnouncement} style={closeIconStyle}>
				<span className="codicon codicon-close"></span>
			</VSCodeButton>
			<h3 style={h3TitleStyle}>
				🎉{"  "}New in v{minorVersion}
			</h3>
			<ul style={ulStyle}>
				<li>
					<b>Cerebras Provider Support:</b> Enhanced performance with updated model selection (Qwen and Llama 3.3 70B
					only) and increased context window for Qwen 3 32B from 16K to 64K tokens.
				</li>
				<li>
					<b>Claude Code for Windows:</b> Improved system prompt handling to fix E2BIG errors and better error messages
					with guidance for common setup issues.
				</li>
				<li>
					<b>Hugging Face Provider:</b> Added as a new API provider with support for their inference API models.
				</li>
				<li>
					<b>Moonshot Chinese Endpoints:</b> Added ability to choose Chinese endpoint for Moonshot provider and added
					Moonshot AI as a new provider.
				</li>
				<li>
					<b>Enhanced Stability:</b> Robust checkpoint timeout handling, fixed MCP servers starting when disabled, and
					improved authentication sync across multiple VSCode windows.
				</li>
			</ul>
			<Accordion isCompact className="pl-0">
				<AccordionItem
					key="1"
					aria-label="Previous Updates"
					title="Previous Updates:"
					classNames={{
						trigger: "bg-transparent border-0 pl-0 pb-0 w-fit",
						title: "font-bold text-[var(--vscode-foreground)]",
						indicator:
							"text-[var(--vscode-foreground)] mb-0.5 -rotate-180 data-[open=true]:-rotate-90 rtl:rotate-0 rtl:data-[open=true]:-rotate-90",
					}}>
					<ul style={ulStyle}>
						<li>
							<b>Optimized for Claude 4:</b> Cline is now optimized to work with the Claude 4 family of models,
							resulting in improved performance, reliability, and new capabilities.
						</li>
						<li>
							<b>Gemini CLI Provider:</b> Added a new Gemini CLI provider that allows you to use your local Gemini
							CLI authentication to access Gemini models for free.
						</li>
						<li>
							<b>WebFetch Tool:</b> Gemini 2.5 Pro and Claude 4 models now support the WebFetch tool, allowing Cline
							to retrieve and summarize web content directly in conversations.
						</li>
						<li>
							<b>Self Knowledge:</b> When using frontier models, Cline is self-aware about his capabilities and
							featureset.
						</li>
						<li>
							<b>Improved Diff Editing:</b> Improved diff editing to achieve record lows in diff edit failures for
							frontier models.
						</li>
						<li>
							<b>Claude 4 Models:</b> Now with support for Anthropic Claude Sonnet 4 and Claude Opus 4 in both
							Anthropic and Vertex providers.
						</li>
						<li>
							<b>New Settings Page:</b> Redesigned settings, now split into tabs for easier navigation and a cleaner
							experience.
						</li>
						<li>
							<b>Nebius AI Studio:</b> Added Nebius AI Studio as a new provider. (Thanks @Aktsvigun!)
						</li>
						<li>
							<b>Workflows:</b> Create and manage workflow files that can be injected into conversations via slash
							commands, making it easy to automate repetitive tasks.
						</li>
						<li>
							<b>Collapsible Task List:</b> Hide your recent tasks when sharing your screen to keep your prompts
							private.
						</li>
						<li>
							<b>Global Endpoint for Vertex AI:</b> Improved availability and reduced rate limiting errors for
							Vertex AI users.
						</li>
					</ul>
				</AccordionItem>
			</Accordion>
			<div style={hrStyle} />
			<p style={linkContainerStyle}>
				Join us on{" "}
				<VSCodeLink style={linkStyle} href="https://x.com/cline">
					X,
				</VSCodeLink>{" "}
				<VSCodeLink style={linkStyle} href="https://discord.gg/cline">
					discord,
				</VSCodeLink>{" "}
				or{" "}
				<VSCodeLink style={linkStyle} href="https://www.reddit.com/r/cline/">
					r/cline
				</VSCodeLink>
				for more updates!
			</p>
		</div>
	)
}

export default memo(Announcement)

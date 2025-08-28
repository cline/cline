import { Accordion, AccordionItem } from "@heroui/react"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { CSSProperties, memo } from "react"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND, VSC_INACTIVE_SELECTION_BACKGROUND } from "@/utils/vscStyles"

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
const _accountIconStyle: CSSProperties = { fontSize: 11 }
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
			<VSCodeButton appearance="icon" data-testid="close-button" onClick={hideAnnouncement} style={closeIconStyle}>
				<span className="codicon codicon-close"></span>
			</VSCodeButton>
			<h3 style={h3TitleStyle}>
				🎉{"  "}New in v{minorVersion}
			</h3>
			<ul style={ulStyle}>
				<li>
					<b>Free Stealth Model</b> Advanced stealth model with 262K context window designed for complex coding tasks.
					Available in the Cline provider for free.
				</li>
				<li>
					<b>Focus Chain:</b> Keeps cline focused on long-horizon tasks with automatic todo list management, breaking
					down complex tasks into manageable steps with real-time progress tracking and passive reminders.
				</li>
				<li>
					<b>Auto Compact:</b> Auto summarizes your task and next steps when your conversation approaches the model's
					context window limit. This significantly helps Cline stay on track for long task sessions!
				</li>
				<li>
					<b>Deep Planning:</b> New <code>/deep-planning</code> slash command transforms Cline into an architect who
					investigates your codebase, asks clarifying questions, and creates a comprehensive plan before writing any
					code.
				</li>
			</ul>
			<Accordion className="pl-0" isCompact>
				<AccordionItem
					aria-label="Previous Updates"
					classNames={{
						trigger: "bg-transparent border-0 pl-0 pb-0 w-fit",
						title: "font-bold text-[var(--vscode-foreground)]",
						indicator:
							"text-[var(--vscode-foreground)] mb-0.5 -rotate-180 data-[open=true]:-rotate-90 rtl:rotate-0 rtl:data-[open=true]:-rotate-90",
					}}
					key="1"
					title="Previous Updates:">
					<ul style={ulStyle}>
						<li>
							<b>1M Context for Claude Sonnet 4:</b> Cline/OpenRouter users get instant access, Anthropic users need
							Tier 4, and Bedrock users must be on a supported region.
						</li>
						<li>
							<b>Optimized for Claude 4:</b> Cline is now optimized to work with the Claude 4 family of models,
							resulting in improved performance, reliability, and new capabilities.
						</li>
						<li>
							<b>Workflows:</b> Create and manage workflow files that can be injected into conversations via slash
							commands, making it easy to automate repetitive tasks.
						</li>
					</ul>
				</AccordionItem>
			</Accordion>
			<div style={hrStyle} />
			<p style={linkContainerStyle}>
				Join us on{" "}
				<VSCodeLink href="https://x.com/cline" style={linkStyle}>
					X,
				</VSCodeLink>{" "}
				<VSCodeLink href="https://discord.gg/cline" style={linkStyle}>
					discord,
				</VSCodeLink>{" "}
				or{" "}
				<VSCodeLink href="https://www.reddit.com/r/cline/" style={linkStyle}>
					r/cline
				</VSCodeLink>
				for more updates!
			</p>
		</div>
	)
}

export default memo(Announcement)

import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { XIcon } from "lucide-react"
import { CSSProperties, memo } from "react"
import { useMount } from "react-use"
import { Button } from "@/components/ui/button"
import { useExtensionState } from "@/context/ExtensionStateContext"
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
const h4TitleStyle: CSSProperties = { margin: "0 0 8px", fontWeight: "bold" }
const ulStyle: CSSProperties = { margin: "0 0 8px", paddingLeft: "12px", listStyleType: "disc" }
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
	const { refreshOpenRouterModels } = useExtensionState()
	// Need to get latest model list in case user hits shortcut button to set model
	useMount(refreshOpenRouterModels)

	return (
		<div style={containerStyle}>
			<Button
				className="absolute top-2.5 right-2"
				data-testid="close-announcement-button"
				onClick={hideAnnouncement}
				size="icon"
				variant="icon">
				<XIcon />
			</Button>
			<h4 style={h4TitleStyle}>
				🎉{"  "}New in v{minorVersion}
			</h4>
			<ul style={ulStyle}>
				<li>
					Cline Teams is now available with unlimited seats. Includes JetBrains support, role-based access control, and
					centralized billing.{" "}
					<VSCodeLink
						href="https://app.cline.bot/login/?utm_source=ext&utm_medium=banner&utm_campaign=free-teams"
						style={linkStyle}>
						Get started with Teams
					</VSCodeLink>
				</li>
				<li>
					Native tool calling is now the default for Claude 4+, Gemini 2.5, Grok 4/Code, and GPT-5. Reduces errors by
					15% and enables parallel tool execution.
				</li>
				<li>
					Auto-approve is now always-on with a redesigned expanding menu. Settings simplified and notifications moved to
					General Settings.
				</li>
			</ul>
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

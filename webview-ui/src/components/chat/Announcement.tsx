import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { CSSProperties, memo } from "react"

interface AnnouncementProps {
	version: string
	hideAnnouncement: () => void
}

const containerStyle: CSSProperties = {
	backgroundColor: "rgba(0, 163, 255, 0.06)",
	border: "1px solid rgba(0, 163, 255, 0.2)",
	borderRadius: "8px",
	padding: "14px 16px",
	margin: "8px 15px",
	position: "relative",
	flexShrink: 0,
}

const closeIconStyle: CSSProperties = { position: "absolute", top: "8px", right: "8px" }

const titleStyle: CSSProperties = {
	margin: "0 0 10px",
	fontWeight: "bold",
	fontSize: "13px",
	display: "flex",
	alignItems: "center",
	gap: "6px",
}

const ulStyle: CSSProperties = {
	margin: "0 0 10px",
	paddingLeft: "14px",
	listStyleType: "disc",
	fontSize: "12px",
	lineHeight: "1.7",
}

const hrStyle: CSSProperties = {
	height: "1px",
	background: "rgba(0, 163, 255, 0.15)",
	border: "none",
	margin: "10px 0",
}

const teaserStyle: CSSProperties = {
	fontSize: "11.5px",
	color: "rgba(255,255,255,0.55)",
	margin: "0 0 8px",
	lineHeight: "1.6",
}

const teaserHighlight: CSSProperties = {
	color: "#00ddff",
	fontWeight: 600,
}

const linkRowStyle: CSSProperties = {
	margin: "0",
	fontSize: "11.5px",
	color: "rgba(255,255,255,0.45)",
}

const linkStyle: CSSProperties = { display: "inline" }

/*
Announcements show automatically when the major.minor version changes (e.g. 0.1.x → 0.2.x).
The latestAnnouncementId is derived from package.json — patch releases do not trigger new banners.
*/
const Announcement = ({ version, hideAnnouncement }: AnnouncementProps) => {
	const minorVersion = version.split(".").slice(0, 2).join(".") // 0.1.3 → 0.1

	return (
		<div style={containerStyle}>
			<VSCodeButton
				appearance="icon"
				data-testid="close-button"
				onClick={hideAnnouncement}
				style={closeIconStyle}
				title="Dismiss">
				<span className="codicon codicon-close" />
			</VSCodeButton>

			<h3 style={titleStyle}>
				<span>🌊</span>
				<span>Welcome to AI-Hydro v{minorVersion}</span>
			</h3>

			<ul style={ulStyle}>
				<li>
					<b>26 built-in hydrological tools</b> — watershed delineation, streamflow, signatures, geomorphic analysis,
					HBV-light calibration, LSTM modelling and more, all from a single conversation.
				</li>
				<li>
					<b>Research memory that persists</b> — HydroSession, ProjectSession, and ResearcherProfile remember your gauge
					data, project context, and expertise across every session. Expensive computations run once and are reused
					forever.
				</li>
				<li>
					<b>Reproducibility built in</b> — every tool call auto-generates a citable methods paragraph and BibTeX entry.
					Export your full session provenance for your paper in one command.
				</li>
				<li>
					<b>Community-extensible</b> — register domain tools (flood frequency, sediment transport, groundwater) via
					Python entry points. Your tools become available to every AI-Hydro user instantly.
				</li>
			</ul>

			<hr style={hrStyle} />

			<p style={teaserStyle}>
				<span style={teaserHighlight}>On the roadmap —</span> Use your existing{" "}
				<span style={teaserHighlight}>ChatGPT Plus or Pro subscription</span> directly in AI-Hydro. No API key, no
				per-token billing. This requires an OpenAI partnership — something we are working toward as the platform grows.
			</p>

			<p style={linkRowStyle}>
				<VSCodeLink href="https://ai-hydro.github.io/AI-Hydro/" style={linkStyle}>
					Documentation
				</VSCodeLink>
				{" · "}
				<VSCodeLink href="https://github.com/AI-Hydro/AI-Hydro/discussions" style={linkStyle}>
					Community
				</VSCodeLink>
				{" · "}
				<VSCodeLink href="https://github.com/AI-Hydro/AI-Hydro/issues" style={linkStyle}>
					Issues
				</VSCodeLink>
				{" · "}
				<VSCodeLink href="https://www.youtube.com/channel/UC8RWDhJm61i2tlV9mt982cw" style={linkStyle}>
					YouTube
				</VSCodeLink>
			</p>
		</div>
	)
}

export default memo(Announcement)

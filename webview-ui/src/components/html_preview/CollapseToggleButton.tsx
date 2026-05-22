import React from "react"

export const CollapseToggleButton: React.FC<{
	expanded: boolean
	onToggle: () => void
	title?: string
}> = ({ expanded, onToggle, title }) => (
	<button
		aria-expanded={expanded}
		onClick={onToggle}
		style={{
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			width: 22,
			height: 22,
			padding: 0,
			flexShrink: 0,
			background: "transparent",
			border: "none",
			borderRadius: 3,
			color: "var(--vscode-foreground, #ddd)",
			cursor: "pointer",
		}}
		title={title ?? (expanded ? "Collapse toolbar" : "Expand toolbar")}
		type="button">
		<span className={`codicon codicon-chevron-${expanded ? "up" : "down"}`} style={{ fontSize: 14 }} />
	</button>
)

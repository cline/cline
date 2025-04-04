import { CSSProperties } from "react"

export const containerStyle: CSSProperties = {
	position: "fixed",
	top: 0,
	left: 0,
	right: 0,
	bottom: 0,
	padding: "10px 0px 0px 20px",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
}

export const headerStyle: CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: "13px",
	paddingRight: 17,
}

export const headerTitleStyle: CSSProperties = {
	color: "var(--vscode-foreground)",
	margin: 0,
}

export const scrollableAreaStyle: CSSProperties = {
	flexGrow: 1,
	overflowY: "scroll",
	paddingRight: 8,
	display: "flex",
	flexDirection: "column",
}

export const tabsContainerStyle: CSSProperties = {
	border: "1px solid var(--vscode-panel-border)",
	borderRadius: "4px",
	padding: "10px",
	marginBottom: "20px",
	background: "var(--vscode-panel-background)",
}

export const tabButtonGroupStyle: CSSProperties = {
	display: "flex",
	gap: "1px",
	marginBottom: "10px",
	marginTop: -8,
	borderBottom: "1px solid var(--vscode-panel-border)",
}

export const contentContainerStyle: CSSProperties = { marginBottom: -12 }

export const textareaContainerStyle: CSSProperties = { marginBottom: 5 }

export const textareaStyle: CSSProperties = { width: "100%" }

export const instructionsTitleStyle: CSSProperties = { fontWeight: "500" }

export const instructionsDescriptionStyle: CSSProperties = {
	fontSize: "12px",
	marginTop: "5px",
	color: "var(--vscode-descriptionForeground)",
}

export const planActContainerStyle: CSSProperties = { marginBottom: 5 }

export const planActCheckboxStyle: CSSProperties = { marginBottom: "5px" }

export const planActDescriptionStyle: CSSProperties = {
	fontSize: "12px",
	marginTop: "5px",
	color: "var(--vscode-descriptionForeground)",
}

export const anonymousReportContainerStyle: CSSProperties = { marginBottom: 5 }

export const anonymousReportCheckboxStyle: CSSProperties = { marginBottom: "5px" }

export const anonymousReportDescriptionStyle: CSSProperties = {
	fontSize: "12px",
	marginTop: "5px",
	color: "var(--vscode-descriptionForeground)",
}

export const linkStyle: CSSProperties = { fontSize: "inherit" }

export const debugTitleStyle: CSSProperties = { marginTop: "10px", marginBottom: "4px" }

export const resetStateButtonStyle: CSSProperties = { marginTop: "5px", width: "auto" }

export const resetStateDescriptionStyle: CSSProperties = {
	fontSize: "12px",
	marginTop: "5px",
	color: "var(--vscode-descriptionForeground)",
}

export const settingsButtonContainerStyle: CSSProperties = {
	marginTop: "auto",
	paddingRight: 8,
	display: "flex",
	justifyContent: "center",
}

export const settingsButtonStyle: CSSProperties = {
	margin: "0 0 16px 0",
}

export const feedbackContainerStyle: CSSProperties = {
	textAlign: "center",
	color: "var(--vscode-descriptionForeground)",
	fontSize: "12px",
	lineHeight: "1.2",
	padding: "0 8px 15px 0",
}

export const feedbackDescriptionStyle: CSSProperties = {
	wordWrap: "break-word",
	margin: 0,
	padding: 0,
}

export const clineLinkStyle: CSSProperties = { display: "inline" }

export const versionTitleStyle: CSSProperties = {
	fontStyle: "italic",
	margin: "10px 0 0 0",
	padding: 0,
}

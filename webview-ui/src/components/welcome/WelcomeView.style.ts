import { CSSProperties } from "react"

export const containerStyle: CSSProperties = {
	position: "fixed",
	top: 0,
	left: 0,
	right: 0,
	bottom: 0,
	padding: "0 0px",
	display: "flex",
	flexDirection: "column",
}

export const containerInnerStyle: CSSProperties = {
	height: "100%",
	padding: "0 20px",
	overflow: "auto",
}

export const clineLogoContainerStyle: CSSProperties = {
	display: "flex",
	justifyContent: "center",
	margin: "20px 0",
}

export const linkStyle: CSSProperties = { display: "inline" }

export const descriptionStyle: CSSProperties = {
	color: "var(--vscode-descriptionForeground)",
}

export const getStartedButtonStyle: CSSProperties = { width: "100%", marginTop: 4 }

export const useApiKeyButtonStyle: CSSProperties = { marginTop: 10, width: "100%" }

export const apiOptionsContainerStyle: CSSProperties = { marginTop: "18px" }

export const letsGoButtonStyle: CSSProperties = { marginTop: "3px" }

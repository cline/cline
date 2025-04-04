import { CSSProperties } from "react"
import styled from "styled-components"
import { CODE_BLOCK_BG_COLOR } from "../common/CodeBlock"

export const containerStyle: CSSProperties = { position: "relative", marginTop: "-1px" }

export const codiconStyle: CSSProperties = { fontSize: "14.5px" }

export const VSCodeCheckboxStyle: CSSProperties = { marginBottom: "8px", marginTop: -1 }

export const VSCodeDropdownStyle: CSSProperties = { width: "100%" }

export const SettingsMenu = styled.div<{ maxWidth?: number }>`
	position: absolute;
	top: calc(100% + 8px);
	right: -2px;
	background: ${CODE_BLOCK_BG_COLOR};
	border: 1px solid var(--vscode-editorGroup-border);
	padding: 8px;
	border-radius: 3px;
	z-index: 1000;
	width: calc(100vw - 57px);
	min-width: 0px;
	max-width: ${(props) => (props.maxWidth ? `${props.maxWidth - 23}px` : "100vw")};

	// Add invisible padding to create a safe hover zone
	&::before {
		content: "";
		position: absolute;
		top: -14px; // Same as margin-top in the parent's top property
		left: 0;
		right: -6px;
		height: 14px;
	}

	&::after {
		content: "";
		position: absolute;
		top: -6px;
		right: 6px;
		width: 10px;
		height: 10px;
		background: ${CODE_BLOCK_BG_COLOR};
		border-left: 1px solid var(--vscode-editorGroup-border);
		border-top: 1px solid var(--vscode-editorGroup-border);
		transform: rotate(45deg);
		z-index: 1; // Ensure arrow stays above the padding
	}
`

export const SettingsGroup = styled.div`
	&:not(:last-child) {
		margin-bottom: 8px;
		// padding-bottom: 8px;
		border-bottom: 1px solid var(--vscode-editorGroup-border);
	}
`

export const SettingsHeader = styled.div`
	font-size: 11px;
	font-weight: 600;
	margin-bottom: 6px;
	color: var(--vscode-foreground);
`

export const SettingsDescription = styled.div<{ isLast?: boolean }>`
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
	margin-bottom: ${(props) => (props.isLast ? "0" : "8px")};
`

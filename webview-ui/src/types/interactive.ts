import type React from "react"

export interface BaseButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	"aria-label": string
	type?: "button" | "submit" | "reset"
}

export interface ModalTriggerButtonProps extends BaseButtonProps {
	"aria-haspopup": "dialog" | "menu" | "listbox" | "tree" | "grid" | true
	"aria-controls"?: string
}

export const InteractiveStyles = {
	buttonReset: {
		border: "none",
		background: "transparent",
		padding: 0,
		margin: 0,
		font: "inherit",
		cursor: "pointer",
	} as const,

	noSelect: {
		userSelect: "none" as const,
		WebkitUserSelect: "none" as const,
		MozUserSelect: "none" as const,
		msUserSelect: "none" as const,
	} as const,

	flexButton: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
	} as const,

	fullWidth: {
		width: "100%",
	} as const,
} as const

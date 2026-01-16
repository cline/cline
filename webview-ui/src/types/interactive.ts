import type React from "react"

export interface BaseButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	"aria-label": string
	type?: "button" | "submit" | "reset"
}

export interface ToggleButtonProps extends BaseButtonProps {
	"aria-expanded": boolean
}

export type VSCodeIconButtonProps = {
	type: "button" | "submit" | "reset"
	"aria-label": string
	onClick: React.MouseEventHandler<HTMLButtonElement>
}

export interface LinkButtonProps extends BaseButtonProps {
	href?: never
}

export interface ModalTriggerButtonProps extends BaseButtonProps {
	"aria-haspopup": "dialog" | "menu" | "listbox" | "tree" | "grid" | true
	"aria-controls"?: string
}

export interface TabButtonProps extends BaseButtonProps {
	role: "tab"
	"aria-selected": boolean
	"aria-controls": string
	tabIndex: 0 | -1
}

export interface SwitchButtonProps extends BaseButtonProps {
	role: "switch"
	"aria-checked": boolean
}

export interface TabNavigationOptions {
	onNext?: () => void
	onPrev?: () => void
	onFirst?: () => void
	onLast?: () => void
	orientation?: "horizontal" | "vertical"
}

export interface TabListProps extends React.HTMLAttributes<HTMLDivElement> {
	role: "tablist"
	"aria-label": string
	"aria-orientation"?: "horizontal" | "vertical"
}

export interface TabPanelProps extends React.HTMLAttributes<HTMLDivElement> {
	role: "tabpanel"
	id: string
	"aria-labelledby": string
	tabIndex: 0 | -1
	hidden?: boolean
}

export interface ListboxProps extends React.HTMLAttributes<HTMLDivElement> {
	role: "listbox"
	"aria-label": string
	"aria-activedescendant"?: string
	tabIndex: number
}

export interface ListboxOptionProps extends React.HTMLAttributes<HTMLDivElement> {
	role: "option"
	"aria-label": string
	"aria-selected": boolean
	id: string
	tabIndex: number
}

export interface DivAsButtonProps extends React.HTMLAttributes<HTMLDivElement> {
	role: "button"
	"aria-label": string
	tabIndex: number
	onClick: React.MouseEventHandler<HTMLDivElement>
	onKeyDown: React.KeyboardEventHandler<HTMLDivElement>
}

export interface DivAsModalTriggerProps extends DivAsButtonProps {
	"aria-haspopup": "dialog" | "menu" | "listbox" | "tree" | "grid" | true
	"aria-expanded"?: boolean
}

export interface FocusTrapOptions {
	enabled?: boolean
	initialFocusRef?: React.RefObject<HTMLElement>
	returnFocusRef?: React.RefObject<HTMLElement>
	onEscape?: () => void
	closeOnOutsideClick?: boolean
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
	"aria-label"?: string
	"aria-labelledby"?: string
	"aria-describedby"?: string
	"aria-invalid"?: boolean
	"aria-errormessage"?: string
	"aria-required"?: boolean
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
	"aria-label"?: string
	"aria-labelledby"?: string
	"aria-describedby"?: string
	"aria-invalid"?: boolean
	"aria-required"?: boolean
}

export interface InputValidationState {
	hasError: boolean
	errorMessage?: string
	errorId?: string
	description?: string
	descriptionId?: string
}

export interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
	"aria-label"?: string
	"aria-describedby"?: string
	href: string
}

export interface ExternalLinkProps extends LinkProps {
	target: "_blank"
	rel: "noopener noreferrer"
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

	focusVisible: {
		outline: "2px solid var(--vscode-focusBorder)",
		outlineOffset: "2px",
	} as const,

	disabled: {
		opacity: 0.5,
		cursor: "not-allowed",
		pointerEvents: "none" as const,
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

export const isToggleButton = (props: unknown): props is ToggleButtonProps =>
	typeof props === "object" && props !== null && "aria-expanded" in props

export const isTabButton = (props: unknown): props is TabButtonProps =>
	typeof props === "object" &&
	props !== null &&
	(props as TabButtonProps).role === "tab" &&
	"aria-selected" in props &&
	"aria-controls" in props

export const isSwitchButton = (props: unknown): props is SwitchButtonProps =>
	typeof props === "object" && props !== null && (props as SwitchButtonProps).role === "switch" && "aria-checked" in props

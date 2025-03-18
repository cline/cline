import React from "react"

interface VSCodeProps {
	children?: React.ReactNode
	onClick?: () => void
	onChange?: (e: any) => void
	onInput?: (e: any) => void
	appearance?: string
	checked?: boolean
	value?: string | number
	placeholder?: string
	href?: string
	"data-testid"?: string
	style?: React.CSSProperties
	slot?: string
	role?: string
	disabled?: boolean
	className?: string
	title?: string
}

export const VSCodeButton: React.FC<VSCodeProps> = ({ children, onClick, appearance, className, ...props }) => {
	// For icon buttons, render children directly without any wrapping
	if (appearance === "icon") {
		return React.createElement(
			"button",
			{
				onClick,
				className: `${className || ""}`,
				"data-appearance": appearance,
				...props,
			},
			children,
		)
	}

	// For regular buttons
	return React.createElement(
		"button",
		{
			onClick,
			className: className,
			...props,
		},
		children,
	)
}

export const VSCodeCheckbox: React.FC<VSCodeProps> = ({ children, onChange, checked, ...props }) =>
	React.createElement("label", {}, [
		React.createElement("input", {
			key: "input",
			type: "checkbox",
			checked,
			onChange: (e: any) => onChange?.({ target: { checked: e.target.checked } }),
			"aria-label": typeof children === "string" ? children : undefined,
			...props,
		}),
		children && React.createElement("span", { key: "label" }, children),
	])

export const VSCodeTextField: React.FC<VSCodeProps> = ({ children, value, onInput, placeholder, ...props }) =>
	React.createElement("div", { style: { position: "relative", display: "inline-block", width: "100%" } }, [
		React.createElement("input", {
			key: "input",
			type: "text",
			value,
			onChange: (e: any) => onInput?.({ target: { value: e.target.value } }),
			placeholder,
			...props,
		}),
		children,
	])

export const VSCodeTextArea: React.FC<VSCodeProps> = ({ value, onChange, ...props }) =>
	React.createElement("textarea", {
		value,
		onChange: (e: any) => onChange?.({ target: { value: e.target.value } }),
		...props,
	})

export const VSCodeLink: React.FC<VSCodeProps> = ({ children, href, ...props }) =>
	React.createElement("a", { href: href || "#", ...props }, children)

export const VSCodeDropdown: React.FC<VSCodeProps> = ({ children, value, onChange, ...props }) =>
	React.createElement("select", { value, onChange, ...props }, children)

export const VSCodeOption: React.FC<VSCodeProps> = ({ children, value, ...props }) =>
	React.createElement("option", { value, ...props }, children)

export const VSCodeRadio: React.FC<VSCodeProps> = ({ children, value, checked, onChange, ...props }) =>
	React.createElement("label", { style: { display: "inline-flex", alignItems: "center" } }, [
		React.createElement("input", {
			key: "input",
			type: "radio",
			value,
			checked,
			onChange,
			...props,
		}),
		children && React.createElement("span", { key: "label", style: { marginLeft: "4px" } }, children),
	])

export const VSCodeRadioGroup: React.FC<VSCodeProps> = ({ children, onChange, ...props }) =>
	React.createElement("div", { role: "radiogroup", onChange, ...props }, children)

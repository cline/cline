import type {
	BaseButtonProps,
	DivAsButtonProps,
	DivAsModalTriggerProps,
	ExternalLinkProps,
	FocusTrapOptions,
	InputProps,
	InputValidationState,
	LinkButtonProps,
	LinkProps,
	ListboxOptionProps,
	ListboxProps,
	ModalTriggerButtonProps,
	SelectProps,
	SwitchButtonProps,
	TabButtonProps,
	TabListProps,
	TabNavigationOptions,
	TabPanelProps,
	ToggleButtonProps,
	VSCodeIconButtonProps,
} from "../types/interactive"
import { InteractiveStyles } from "../types/interactive"

export type {
	DivAsButtonProps,
	DivAsModalTriggerProps,
	ExternalLinkProps,
	FocusTrapOptions,
	InputProps,
	InputValidationState,
	LinkProps,
	ListboxOptionProps,
	ListboxProps,
	SelectProps,
	TabListProps,
	TabNavigationOptions,
	TabPanelProps,
}

// Keyboard Navigation

export const createKeyboardActivationHandler =
	(handler: () => void): React.KeyboardEventHandler<HTMLElement> =>
	(e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault()
			handler()
		}
	}

export const createArrowKeyNavigationHandler =
	(options: {
		onNext?: () => void
		onPrev?: () => void
		onFirst?: () => void
		onLast?: () => void
		orientation?: "horizontal" | "vertical" | "both"
	}): React.KeyboardEventHandler<HTMLElement> =>
	(e) => {
		const { onNext, onPrev, onFirst, onLast, orientation = "horizontal" } = options
		const isHorizontal = orientation === "horizontal" || orientation === "both"
		const isVertical = orientation === "vertical" || orientation === "both"

		switch (e.key) {
			case "ArrowRight":
				if (isHorizontal && onNext) {
					e.preventDefault()
					onNext()
				}
				break
			case "ArrowLeft":
				if (isHorizontal && onPrev) {
					e.preventDefault()
					onPrev()
				}
				break
			case "ArrowDown":
				if (isVertical && onNext) {
					e.preventDefault()
					onNext()
				}
				break
			case "ArrowUp":
				if (isVertical && onPrev) {
					e.preventDefault()
					onPrev()
				}
				break
			case "Home":
				if (onFirst) {
					e.preventDefault()
					onFirst()
				}
				break
			case "End":
				if (onLast) {
					e.preventDefault()
					onLast()
				}
				break
		}
	}

export const createEscapeHandler =
	(onEscape: () => void): React.KeyboardEventHandler<HTMLElement> =>
	(e) => {
		if (e.key === "Escape") {
			e.preventDefault()
			onEscape()
		}
	}

export const combineKeyboardHandlers =
	(...handlers: (React.KeyboardEventHandler<HTMLElement> | undefined)[]): React.KeyboardEventHandler<HTMLElement> =>
	(e) => {
		for (const handler of handlers) {
			handler?.(e)
		}
	}

// Button Props

export const createBaseButtonProps = (
	ariaLabel: string,
	onClick: React.MouseEventHandler<HTMLButtonElement>,
	type: "button" | "submit" | "reset" = "button",
): BaseButtonProps => ({
	type,
	"aria-label": ariaLabel,
	onClick,
})

export const createToggleButtonProps = (
	isExpanded: boolean,
	onToggle: () => void,
	ariaLabel?: string,
	collapseOnEscape?: boolean,
): ToggleButtonProps => {
	const props: ToggleButtonProps = {
		type: "button",
		"aria-expanded": isExpanded,
		"aria-label": ariaLabel || (isExpanded ? "Collapse" : "Expand"),
		onClick: onToggle,
	}
	if (collapseOnEscape && isExpanded) {
		props.onKeyDown = createEscapeHandler(onToggle)
	}
	return props
}

export const createIconButtonProps = (
	ariaLabel: string,
	onClick: React.MouseEventHandler<HTMLButtonElement>,
): VSCodeIconButtonProps => ({
	type: "button",
	"aria-label": ariaLabel,
	onClick,
})

export const createLinkButtonProps = (
	ariaLabel: string,
	onClick: React.MouseEventHandler<HTMLButtonElement>,
): LinkButtonProps => ({
	type: "button",
	"aria-label": ariaLabel,
	onClick,
})

export const createModalTriggerButtonProps = (
	ariaLabel: string,
	onClick: React.MouseEventHandler<HTMLButtonElement>,
	options?: {
		modalId?: string
		popupType?: "dialog" | "menu" | "listbox" | "tree" | "grid" | true
		onEscape?: () => void
	},
): ModalTriggerButtonProps => {
	const { modalId, popupType = "dialog", onEscape } = options || {}
	const props: ModalTriggerButtonProps = {
		type: "button",
		"aria-label": ariaLabel,
		"aria-haspopup": popupType,
		...(modalId && { "aria-controls": modalId }),
		onClick,
	}
	if (onEscape) {
		props.onKeyDown = createEscapeHandler(onEscape)
	}
	return props
}

export const createTabButtonProps = (
	ariaLabel: string,
	isSelected: boolean,
	panelId: string,
	onClick: React.MouseEventHandler<HTMLButtonElement>,
	keyboardNav?: TabNavigationOptions,
): TabButtonProps => {
	const baseProps: TabButtonProps = {
		type: "button",
		role: "tab",
		"aria-label": ariaLabel,
		"aria-selected": isSelected,
		"aria-controls": panelId,
		tabIndex: isSelected ? 0 : -1,
		onClick,
	}
	if (keyboardNav) {
		const { onNext, onPrev, onFirst, onLast, orientation = "horizontal" } = keyboardNav
		baseProps.onKeyDown = createArrowKeyNavigationHandler({ onNext, onPrev, onFirst, onLast, orientation })
	}
	return baseProps
}

export const createSwitchButtonProps = (
	ariaLabel: string,
	isChecked: boolean,
	onToggle: (checked: boolean) => void,
): SwitchButtonProps => ({
	type: "button",
	role: "switch",
	"aria-label": ariaLabel,
	"aria-checked": isChecked,
	onClick: () => onToggle(!isChecked),
})

// Tab List & Panel Props

export const createTabListProps = (ariaLabel: string, orientation: "horizontal" | "vertical" = "horizontal"): TabListProps => ({
	role: "tablist",
	"aria-label": ariaLabel,
	"aria-orientation": orientation,
})

export const createTabPanelProps = (panelId: string, tabId: string, isVisible: boolean): TabPanelProps => ({
	role: "tabpanel",
	id: panelId,
	"aria-labelledby": tabId,
	tabIndex: isVisible ? 0 : -1,
	hidden: !isVisible,
})

// Listbox Props

export const createListboxProps = (ariaLabel: string, activeDescendantId?: string): ListboxProps => ({
	role: "listbox",
	"aria-label": ariaLabel,
	"aria-activedescendant": activeDescendantId,
	tabIndex: 0,
})

export const createListboxOptionProps = (
	ariaLabel: string,
	isSelected: boolean,
	id: string,
	onSelect: () => void,
	isDisabled?: boolean,
): ListboxOptionProps & { onClick: () => void; onKeyDown: React.KeyboardEventHandler<HTMLElement> } => ({
	role: "option",
	"aria-label": ariaLabel,
	"aria-selected": isSelected,
	id,
	tabIndex: isSelected ? 0 : -1,
	onClick: isDisabled ? () => {} : onSelect,
	onKeyDown: isDisabled ? () => {} : createKeyboardActivationHandler(onSelect),
})

// Div as Button

export const createDivAsButtonProps = (ariaLabel: string, onClick: () => void): DivAsButtonProps => ({
	role: "button",
	"aria-label": ariaLabel,
	tabIndex: 0,
	onClick,
	onKeyDown: createKeyboardActivationHandler(onClick),
})

export const createDivAsModalTriggerProps = (
	ariaLabel: string,
	onClick: () => void,
	isExpanded?: boolean,
	popupType: "dialog" | "menu" | "listbox" | "tree" | "grid" | true = "dialog",
): DivAsModalTriggerProps => ({
	role: "button",
	"aria-label": ariaLabel,
	"aria-haspopup": popupType,
	"aria-expanded": isExpanded,
	tabIndex: 0,
	onClick,
	onKeyDown: createKeyboardActivationHandler(onClick),
})

// Focus Trap

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export const getFocusableElements = (container: HTMLElement, sortInputsFirst = false): HTMLElement[] => {
	const elements = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
		(el) => !el.hasAttribute("disabled") && !el.hasAttribute("aria-hidden"),
	)
	if (!sortInputsFirst) {
		return elements
	}

	return elements.sort((a, b) => {
		const aIsInput = a.tagName === "INPUT" || a.tagName === "TEXTAREA"
		const bIsInput = b.tagName === "INPUT" || b.tagName === "TEXTAREA"
		if (aIsInput && !bIsInput) {
			return -1
		}
		if (!aIsInput && bIsInput) {
			return 1
		}
		return 0
	})
}

export const createFocusTrapHandler =
	(
		containerRef: React.RefObject<HTMLElement>,
		options?: Pick<FocusTrapOptions, "onEscape">,
	): React.KeyboardEventHandler<HTMLElement> =>
	(e) => {
		const container = containerRef.current
		if (!container) {
			return
		}

		if (e.key === "Escape" && options?.onEscape) {
			e.preventDefault()
			options.onEscape()
			return
		}

		if (e.key !== "Tab") {
			return
		}

		const focusableElements = getFocusableElements(container)
		if (focusableElements.length === 0) {
			return
		}

		const firstElement = focusableElements[0]
		const lastElement = focusableElements[focusableElements.length - 1]

		if (e.shiftKey && document.activeElement === firstElement) {
			e.preventDefault()
			lastElement.focus()
		} else if (!e.shiftKey && document.activeElement === lastElement) {
			e.preventDefault()
			firstElement.focus()
		}
	}

export const focusFirstElement = (container: HTMLElement, initialFocusRef?: React.RefObject<HTMLElement>): void => {
	if (initialFocusRef?.current) {
		initialFocusRef.current.focus()
		return
	}
	const focusableElements = getFocusableElements(container)
	focusableElements[0]?.focus()
}

// Form Input

type ValidationAriaProps = {
	"aria-invalid"?: boolean
	"aria-describedby"?: string
	"aria-errormessage"?: string
}

const applyValidationProps = (validation?: InputValidationState): ValidationAriaProps => {
	if (!validation) {
		return {}
	}

	const { hasError, errorId, descriptionId } = validation
	const props: ValidationAriaProps = {}

	if (hasError) {
		props["aria-invalid"] = true
	}

	const describedByIds: string[] = []
	if (descriptionId) {
		describedByIds.push(descriptionId)
	}
	if (hasError && errorId) {
		describedByIds.push(errorId)
		props["aria-errormessage"] = errorId
	}
	if (describedByIds.length > 0) {
		props["aria-describedby"] = describedByIds.join(" ")
	}

	return props
}

export const createInputProps = (ariaLabel: string, validation?: InputValidationState, inputId?: string): InputProps => ({
	"aria-label": ariaLabel,
	...(inputId && { id: inputId }),
	...applyValidationProps(validation),
})

export const createSelectProps = (ariaLabel: string, validation?: InputValidationState, selectId?: string): SelectProps => ({
	"aria-label": ariaLabel,
	...(selectId && { id: selectId }),
	...applyValidationProps(validation),
})

export const generateFieldIds = (
	baseId: string,
): { inputId: string; labelId: string; descriptionId: string; errorId: string } => ({
	inputId: baseId,
	labelId: `${baseId}-label`,
	descriptionId: `${baseId}-description`,
	errorId: `${baseId}-error`,
})

// Link Props

export const createLinkProps = (href: string, ariaLabel?: string): LinkProps => {
	const props: LinkProps = { href }
	if (ariaLabel) {
		props["aria-label"] = ariaLabel
	}
	return props
}

export const createExternalLinkProps = (href: string, ariaLabel: string): ExternalLinkProps => ({
	href,
	target: "_blank",
	rel: "noopener noreferrer",
	"aria-label": `${ariaLabel} (opens in new tab)`,
})

// Focus Visibility (WCAG 2.4.11)

export const ensureFocusVisible = (element: HTMLElement, options?: ScrollIntoViewOptions): void => {
	element.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest", ...options })
}

export const createFocusVisibleHandler =
	(scrollOptions?: ScrollIntoViewOptions): React.FocusEventHandler<HTMLElement> =>
	(e) => {
		ensureFocusVisible(e.currentTarget, scrollOptions)
	}

export const isElementPartiallyVisible = (element: HTMLElement): boolean => {
	const rect = element.getBoundingClientRect()
	const windowHeight = window.innerHeight || document.documentElement.clientHeight
	const windowWidth = window.innerWidth || document.documentElement.clientWidth
	return rect.top < windowHeight && rect.bottom > 0 && rect.left < windowWidth && rect.right > 0
}

// Style Utilities

export const mergeInteractiveStyles = <T extends React.CSSProperties>(
	baseStyle: keyof typeof InteractiveStyles | (keyof typeof InteractiveStyles)[],
	customStyle?: T,
): React.CSSProperties => {
	let baseStyles: React.CSSProperties

	if (Array.isArray(baseStyle)) {
		const merged: React.CSSProperties = {}
		for (const key of baseStyle) {
			Object.assign(merged, InteractiveStyles[key])
		}
		baseStyles = merged
	} else {
		baseStyles = InteractiveStyles[baseStyle]
	}

	return { ...baseStyles, ...customStyle }
}

export const createButtonStyle = {
	reset: (customStyle?: React.CSSProperties): React.CSSProperties => mergeInteractiveStyles(["buttonReset"], customStyle),

	flexReset: (customStyle?: React.CSSProperties): React.CSSProperties =>
		mergeInteractiveStyles(["buttonReset", "flexButton", "noSelect"], customStyle),

	fullWidthFlex: (customStyle?: React.CSSProperties): React.CSSProperties =>
		mergeInteractiveStyles(["buttonReset", "flexButton", "fullWidth", "noSelect"], customStyle),

	icon: (customStyle?: React.CSSProperties): React.CSSProperties =>
		mergeInteractiveStyles(["buttonReset", "flexButton", "noSelect"], customStyle),
}

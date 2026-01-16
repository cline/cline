import type { BaseButtonProps, DivAsModalTriggerProps, ModalTriggerButtonProps, ToggleButtonProps } from "../types/interactive"
import { InteractiveStyles } from "../types/interactive"

export const createKeyboardActivationHandler =
	(handler: () => void): React.KeyboardEventHandler<HTMLElement> =>
	(e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault()
			handler()
		}
	}

type ArrowNavOptions = {
	onNext?: () => void
	onPrev?: () => void
	onFirst?: () => void
	onLast?: () => void
	orientation?: "horizontal" | "vertical" | "both"
}

export const createArrowKeyNavigationHandler =
	({ onNext, onPrev, onFirst, onLast, orientation = "horizontal" }: ArrowNavOptions): React.KeyboardEventHandler<HTMLElement> =>
	(e) => {
		const isHorizontal = orientation === "horizontal" || orientation === "both"
		const isVertical = orientation === "vertical" || orientation === "both"

		const keyActions: Record<string, (() => void) | undefined> = {
			ArrowRight: isHorizontal ? onNext : undefined,
			ArrowLeft: isHorizontal ? onPrev : undefined,
			ArrowDown: isVertical ? onNext : undefined,
			ArrowUp: isVertical ? onPrev : undefined,
			Home: onFirst,
			End: onLast,
		}

		const action = keyActions[e.key]
		if (action) {
			e.preventDefault()
			action()
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
	(e) =>
		handlers.forEach((h) => h?.(e))

export const createBaseButtonProps = (
	ariaLabel: string,
	onClick: React.MouseEventHandler<HTMLButtonElement>,
	type: "button" | "submit" | "reset" = "button",
): BaseButtonProps => ({ type, "aria-label": ariaLabel, onClick })

export const createIconButtonProps = createBaseButtonProps

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

type PopupType = "dialog" | "menu" | "listbox" | "tree" | "grid" | true

export const createModalTriggerButtonProps = (
	ariaLabel: string,
	onClick: React.MouseEventHandler<HTMLButtonElement>,
	options?: { modalId?: string; popupType?: PopupType; onEscape?: () => void },
): ModalTriggerButtonProps => {
	const props: ModalTriggerButtonProps = {
		type: "button",
		"aria-label": ariaLabel,
		"aria-haspopup": options?.popupType ?? "dialog",
		onClick,
	}

	if (options?.modalId) {
		props["aria-controls"] = options.modalId
	}

	if (options?.onEscape) {
		props.onKeyDown = createEscapeHandler(options.onEscape)
	}

	return props
}

export const createDivAsModalTriggerProps = (
	ariaLabel: string,
	onClick: () => void,
	isExpanded?: boolean,
	popupType: PopupType = "dialog",
): DivAsModalTriggerProps => ({
	role: "button",
	"aria-label": ariaLabel,
	"aria-haspopup": popupType,
	"aria-expanded": isExpanded,
	tabIndex: 0,
	onClick,
	onKeyDown: createKeyboardActivationHandler(onClick),
})

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export const getFocusableElements = (container: HTMLElement, sortInputsFirst = false): HTMLElement[] => {
	const elements = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
		(el) => !el.hasAttribute("disabled") && !el.hasAttribute("aria-hidden"),
	)

	if (!sortInputsFirst) {
		return elements
	}

	const isInputElement = (el: HTMLElement): boolean => el.tagName === "INPUT" || el.tagName === "TEXTAREA"

	return elements.sort((a, b) => {
		const aIsInput = isInputElement(a)
		const bIsInput = isInputElement(b)
		if (aIsInput && !bIsInput) return -1
		if (!aIsInput && bIsInput) return 1
		return 0
	})
}

const mergeStyles = (keys: (keyof typeof InteractiveStyles)[], custom?: React.CSSProperties): React.CSSProperties => {
	const result: React.CSSProperties = {}
	for (const key of keys) {
		Object.assign(result, InteractiveStyles[key])
	}
	return custom ? Object.assign(result, custom) : result
}

export const createButtonStyle = {
	reset: (custom?: React.CSSProperties) => mergeStyles(["buttonReset"], custom),
	flexReset: (custom?: React.CSSProperties) => mergeStyles(["buttonReset", "flexButton", "noSelect"], custom),
	fullWidthFlex: (custom?: React.CSSProperties) => mergeStyles(["buttonReset", "flexButton", "fullWidth", "noSelect"], custom),
	icon: (custom?: React.CSSProperties) => mergeStyles(["buttonReset", "flexButton", "noSelect"], custom),
}

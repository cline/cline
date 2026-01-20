import type { BaseButtonProps, ModalTriggerButtonProps } from "../types/interactive"
import { InteractiveStyles } from "../types/interactive"

export const createBaseButtonProps = (
	ariaLabel: string,
	onClick: React.MouseEventHandler<HTMLButtonElement>,
	type: "button" | "submit" | "reset" = "button",
): BaseButtonProps => ({ type, "aria-label": ariaLabel, onClick })

export const createIconButtonProps = createBaseButtonProps

type PopupType = "dialog" | "menu" | "listbox" | "tree" | "grid" | true

export const createModalTriggerButtonProps = (
	ariaLabel: string,
	onClick: React.MouseEventHandler<HTMLButtonElement>,
	options?: { modalId?: string; popupType?: PopupType },
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

	return props
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

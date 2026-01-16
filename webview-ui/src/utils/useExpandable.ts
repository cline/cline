import { useCallback, useState } from "react"
import { createKeyboardActivationHandler } from "./interactiveProps"

interface UseExpandableOptions {
	defaultExpanded?: boolean
	onToggle?: (isExpanded: boolean) => void
}

interface UseExpandableReturn {
	isExpanded: boolean
	setIsExpanded: React.Dispatch<React.SetStateAction<boolean>>
	toggle: () => void
	triggerProps: {
		"aria-expanded": boolean
		onClick: () => void
		onKeyDown: React.KeyboardEventHandler<HTMLElement>
	}
}

export function useExpandable(options: UseExpandableOptions = {}): UseExpandableReturn {
	const { defaultExpanded = false, onToggle } = options
	const [isExpanded, setIsExpanded] = useState(defaultExpanded)

	const toggle = useCallback(() => {
		setIsExpanded((prev) => {
			const newValue = !prev
			onToggle?.(newValue)
			return newValue
		})
	}, [onToggle])

	const triggerProps = {
		"aria-expanded": isExpanded,
		onClick: toggle,
		onKeyDown: createKeyboardActivationHandler(toggle),
	}

	return { isExpanded, setIsExpanded, toggle, triggerProps }
}

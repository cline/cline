import { useCallback, useMemo, useRef, useState } from "react"
import { combineKeyboardHandlers, createArrowKeyNavigationHandler, createEscapeHandler } from "./interactiveProps"

interface UseListboxNavigationOptions {
	itemCount: number
	isOpen: boolean
	loop?: boolean
	onSelect?: (index: number) => void
	onClose?: () => void
}

interface UseListboxNavigationResult {
	selectedIndex: number
	setSelectedIndex: React.Dispatch<React.SetStateAction<number>>
	handleKeyDown: React.KeyboardEventHandler<HTMLElement>
	resetSelection: () => void
}

export function useListboxNavigation({
	itemCount,
	isOpen,
	loop = false,
	onSelect,
	onClose,
}: UseListboxNavigationOptions): UseListboxNavigationResult {
	const [selectedIndex, setSelectedIndex] = useState(0)
	const selectedIndexRef = useRef(selectedIndex)
	selectedIndexRef.current = selectedIndex

	const resetSelection = useCallback(() => setSelectedIndex(0), [])

	const handleKeyDown = useMemo(() => {
		if (!isOpen || itemCount === 0) {
			return () => {}
		}

		const arrowHandler = createArrowKeyNavigationHandler({
			onNext: () => setSelectedIndex((prev) => (loop ? (prev + 1) % itemCount : Math.min(prev + 1, itemCount - 1))),
			onPrev: () => setSelectedIndex((prev) => (loop ? (prev - 1 + itemCount) % itemCount : Math.max(prev - 1, 0))),
			onFirst: () => setSelectedIndex(0),
			onLast: () => setSelectedIndex(itemCount - 1),
			orientation: "vertical",
		})

		const enterHandler: React.KeyboardEventHandler<HTMLElement> = (e) => {
			if (e.key === "Enter" && onSelect) {
				e.preventDefault()
				onSelect(selectedIndexRef.current)
			}
		}

		const escapeHandler = onClose ? createEscapeHandler(onClose) : undefined

		return combineKeyboardHandlers(arrowHandler, enterHandler, escapeHandler)
	}, [isOpen, itemCount, loop, onSelect, onClose])

	return { selectedIndex, setSelectedIndex, handleKeyDown, resetSelection }
}

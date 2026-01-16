import { useCallback, useMemo, useRef, useState } from "react"
import { createArrowKeyNavigationHandler } from "./interactiveProps"

export interface ToolbarItemHandle {
	focus: () => void
}

type FocusableRef = ToolbarItemHandle | HTMLElement | null

interface UseToolbarNavigationOptions {
	itemCount: number
	loop?: boolean
	orientation?: "horizontal" | "vertical"
}

interface ToolbarItemProps {
	tabIndex: number
	onKeyDown: React.KeyboardEventHandler<HTMLElement>
	onFocus: () => void
	ref: (el: FocusableRef) => void
}

interface UseToolbarNavigationResult {
	focusedIndex: number
	getItemProps: (index: number) => ToolbarItemProps
	setItemRef: (index: number, el: FocusableRef) => void
	containerProps: { role: "toolbar" }
}

export function useToolbarNavigation({
	itemCount,
	loop = true,
	orientation = "horizontal",
}: UseToolbarNavigationOptions): UseToolbarNavigationResult {
	const [focusedIndex, setFocusedIndex] = useState(0)
	const itemRefs = useRef<FocusableRef[]>([])

	const focusItem = useCallback((index: number) => {
		const item = itemRefs.current[index]
		if (item && "focus" in item && typeof item.focus === "function") {
			item.focus()
		}
	}, [])

	const navigateToIndex = useCallback(
		(newIndex: number) => {
			setFocusedIndex(newIndex)
			focusItem(newIndex)
		},
		[focusItem],
	)

	const createItemKeyHandler = useCallback(
		(currentIndex: number) => {
			const lastIndex = itemCount - 1
			const getNextIndex = () => {
				if (loop) {
					return currentIndex === lastIndex ? 0 : currentIndex + 1
				}
				return Math.min(currentIndex + 1, lastIndex)
			}
			const getPrevIndex = () => {
				if (loop) {
					return currentIndex === 0 ? lastIndex : currentIndex - 1
				}
				return Math.max(currentIndex - 1, 0)
			}

			return createArrowKeyNavigationHandler({
				onNext: () => navigateToIndex(getNextIndex()),
				onPrev: () => navigateToIndex(getPrevIndex()),
				onFirst: () => navigateToIndex(0),
				onLast: () => navigateToIndex(lastIndex),
				orientation,
			})
		},
		[itemCount, loop, orientation, navigateToIndex],
	)

	const keyHandlers = useMemo(
		() => Array.from({ length: itemCount }, (_, i) => createItemKeyHandler(i)),
		[itemCount, createItemKeyHandler],
	)

	const setItemRef = useCallback((index: number, el: FocusableRef) => {
		itemRefs.current[index] = el
	}, [])

	const refCallbacks = useMemo(
		() => Array.from({ length: itemCount }, (_, i) => (el: FocusableRef) => setItemRef(i, el)),
		[itemCount, setItemRef],
	)

	const getItemProps = useCallback(
		(index: number): ToolbarItemProps => ({
			tabIndex: 0,
			onKeyDown: keyHandlers[index],
			onFocus: () => setFocusedIndex(index),
			ref: refCallbacks[index],
		}),
		[keyHandlers, refCallbacks],
	)

	return {
		focusedIndex,
		getItemProps,
		setItemRef,
		containerProps: { role: "toolbar" as const },
	}
}

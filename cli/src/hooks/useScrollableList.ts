/**
 * Shared hook for scrollable list windowing in terminal UIs
 * Used by AuthView (provider list) and ModelPicker (model list)
 */

import { useMemo } from "react"

interface ScrollableListResult {
	visibleStart: number
	visibleCount: number
	showTopIndicator: boolean
	showBottomIndicator: boolean
}

/**
 * Calculate visible window for a scrollable list
 * Keeps the selected item in view while showing scroll indicators
 *
 * @param itemCount - Total number of items in the list
 * @param selectedIndex - Currently selected item index
 * @param maxRows - Maximum rows to display (indicators take up row space when shown)
 */
export function useScrollableList(itemCount: number, selectedIndex: number, maxRows: number): ScrollableListResult {
	return useMemo(() => {
		if (itemCount <= maxRows) {
			return {
				visibleStart: 0,
				visibleCount: itemCount,
				showTopIndicator: false,
				showBottomIndicator: false,
			}
		}

		// Determine if we need indicators based on index position
		const needsTopIndicator = selectedIndex > 0
		const needsBottomIndicator = selectedIndex < itemCount - 1

		// Calculate how many items we can show (subtract space for indicators)
		let itemSlots = maxRows
		if (needsTopIndicator && selectedIndex >= maxRows - 1) itemSlots--
		if (needsBottomIndicator && selectedIndex <= itemCount - maxRows) itemSlots--

		// Calculate start position keeping selected item in view
		const maxStart = itemCount - itemSlots
		const idealStart = selectedIndex - Math.floor(itemSlots / 2)
		const start = Math.max(0, Math.min(idealStart, maxStart))

		const showTop = start > 0
		const showBottom = start + itemSlots < itemCount

		// Recalculate item slots based on actual indicators shown
		let finalItemSlots = maxRows
		if (showTop) finalItemSlots--
		if (showBottom) finalItemSlots--

		const finalStart = Math.max(0, Math.min(selectedIndex - Math.floor(finalItemSlots / 2), itemCount - finalItemSlots))

		return {
			visibleStart: finalStart,
			visibleCount: finalItemSlots,
			showTopIndicator: finalStart > 0,
			showBottomIndicator: finalStart + finalItemSlots < itemCount,
		}
	}, [itemCount, selectedIndex, maxRows])
}

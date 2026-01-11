import { useEffect, useRef, useState } from "react"

interface UseMenuAnnouncementOptions<T> {
	/** The list of items in the menu */
	items: T[]
	/** The currently selected index */
	selectedIndex: number
	/** Function to get the label for an item */
	getItemLabel: (item: T) => string
	/** Optional function to check if an item is selectable (default: all items are selectable) */
	isItemSelectable?: (item: T) => boolean
}

interface UseMenuAnnouncementResult {
	/** The current announcement text for screen readers */
	announcement: string
}

/**
 * Hook to manage screen reader announcements for menu components.
 * Automatically announces the currently selected item when the selection changes.
 * The announcement is cleared after a short delay to avoid interfering with DOM queries.
 */
export function useMenuAnnouncement<T>({
	items,
	selectedIndex,
	getItemLabel,
	isItemSelectable = () => true,
}: UseMenuAnnouncementOptions<T>): UseMenuAnnouncementResult {
	const [announcement, setAnnouncement] = useState("")
	const clearTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const hasNavigatedRef = useRef(false)
	const previousIndexRef = useRef(selectedIndex)

	// Announce selected item when user navigates (not on initial render)
	useEffect(() => {
		// Clear any pending timeout
		if (clearTimeoutRef.current) {
			clearTimeout(clearTimeoutRef.current)
			clearTimeoutRef.current = null
		}

		// Only announce if user has navigated (index changed from previous value)
		const hasIndexChanged = previousIndexRef.current !== selectedIndex
		previousIndexRef.current = selectedIndex

		if (hasIndexChanged) {
			hasNavigatedRef.current = true
		}

		// Skip announcement if user hasn't navigated yet (menu just opened)
		if (!hasNavigatedRef.current) {
			return
		}

		if (items.length > 0 && selectedIndex >= 0 && selectedIndex < items.length) {
			const selectedItem = items[selectedIndex]
			if (isItemSelectable(selectedItem)) {
				const label = getItemLabel(selectedItem)
				setAnnouncement(`${label}, ${selectedIndex + 1} of ${items.length}`)

				// Clear announcement after screen reader has time to read it
				clearTimeoutRef.current = setTimeout(() => {
					setAnnouncement("")
				}, 1000)
			}
		}

		return () => {
			if (clearTimeoutRef.current) {
				clearTimeout(clearTimeoutRef.current)
				clearTimeoutRef.current = null
			}
		}
	}, [selectedIndex, items, getItemLabel, isItemSelectable])

	return {
		announcement,
	}
}

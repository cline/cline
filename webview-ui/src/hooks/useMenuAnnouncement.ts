import { useCallback, useEffect, useState } from "react"

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
	/** Announce a selection was made */
	announceSelection: (label: string) => void
}

/**
 * Hook to manage screen reader announcements for menu components.
 * Automatically announces the currently selected item when the selection changes.
 */
export function useMenuAnnouncement<T>({
	items,
	selectedIndex,
	getItemLabel,
	isItemSelectable = () => true,
}: UseMenuAnnouncementOptions<T>): UseMenuAnnouncementResult {
	const [announcement, setAnnouncement] = useState("")

	// Announce selected item when it changes
	useEffect(() => {
		if (items.length > 0 && selectedIndex >= 0 && selectedIndex < items.length) {
			const selectedItem = items[selectedIndex]
			if (isItemSelectable(selectedItem)) {
				const label = getItemLabel(selectedItem)
				setAnnouncement(`${label}, ${selectedIndex + 1} of ${items.length}`)
			}
		}
	}, [selectedIndex, items, getItemLabel, isItemSelectable])

	const announceSelection = useCallback((label: string) => {
		setAnnouncement(`Selected ${label}`)
	}, [])

	return {
		announcement,
		announceSelection,
	}
}

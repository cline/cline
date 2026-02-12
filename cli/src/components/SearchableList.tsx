/**
 * Generic searchable list component with keyboard navigation
 * Used by ProviderPicker, ModelPicker, LanguagePicker, etc.
 */

import { Box, Text, useInput } from "ink"
// biome-ignore lint/correctness/noUnusedImports: React is needed for JSX at runtime
import React, { useEffect, useMemo, useState } from "react"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"
import { useScrollableList } from "../hooks/useScrollableList"
import { fuzzyFilter } from "../utils/fuzzy-search"
import { isMouseEscapeSequence } from "../utils/input"

export interface SearchableListItem {
	id: string
	label: string
	suffix?: string // Optional suffix like "(configured)" or "(current)"
	isDisabled?: boolean // If true, item cannot be selected (e.g., section headers)
	data?: Record<string, unknown> // Optional arbitrary data attached to the item
}

interface SearchableListProps<T extends SearchableListItem> {
	items: T[]
	onSelect: (item: T) => void
	isActive?: boolean
	maxRows?: number
	filterFn?: (item: T, search: string) => boolean
}

const DEFAULT_MAX_ROWS = 8

export function SearchableList<T extends SearchableListItem>({
	items,
	onSelect,
	isActive = true,
	maxRows = DEFAULT_MAX_ROWS,
	filterFn,
}: SearchableListProps<T>) {
	const { isRawModeSupported } = useStdinContext()
	const [search, setSearch] = useState("")
	const [index, setIndex] = useState(0)

	// Filter items by search using fuzzy matching
	const filteredItems = useMemo(() => {
		if (!search) return items
		// Use custom filter if provided, otherwise use fuzzy search
		if (filterFn) {
			return items.filter((item) => filterFn(item, search))
		}
		return fuzzyFilter(items, search, (item) => `${item.label} ${item.id}`)
	}, [items, search, filterFn])

	// Use shared scrollable list hook for windowing
	const { visibleStart, visibleCount, showTopIndicator, showBottomIndicator } = useScrollableList(
		filteredItems.length,
		index,
		maxRows,
	)

	const visibleItems = useMemo(() => {
		return filteredItems.slice(visibleStart, visibleStart + visibleCount)
	}, [filteredItems, visibleStart, visibleCount])

	// Reset index when search changes
	useEffect(() => {
		setIndex(0)
	}, [search])

	// Find next selectable index (skipping disabled items)
	const findNextSelectableIndex = (currentIndex: number, direction: "up" | "down"): number => {
		const step = direction === "up" ? -1 : 1
		let nextIndex = currentIndex + step

		// Keep moving in the direction until we find a selectable item or hit bounds
		while (nextIndex >= 0 && nextIndex < filteredItems.length) {
			if (!filteredItems[nextIndex].isDisabled) {
				return nextIndex
			}
			nextIndex += step
		}

		// If we couldn't find a selectable item in that direction, stay at current
		return currentIndex
	}

	// Ensure initial index points to a selectable item
	useEffect(() => {
		if (filteredItems.length > 0 && filteredItems[index]?.isDisabled) {
			// Find the first selectable item
			const firstSelectable = filteredItems.findIndex((item) => !item.isDisabled)
			if (firstSelectable !== -1) {
				setIndex(firstSelectable)
			}
		}
	}, [filteredItems, index])

	useInput(
		(input, key) => {
			// Filter out mouse escape sequences
			if (isMouseEscapeSequence(input)) {
				return
			}

			if (key.upArrow) {
				setIndex((prev) => findNextSelectableIndex(prev, "up"))
			} else if (key.downArrow) {
				setIndex((prev) => findNextSelectableIndex(prev, "down"))
			} else if (key.return || key.tab) {
				const selectedItem = filteredItems[index]
				if (selectedItem && !selectedItem.isDisabled) {
					onSelect(selectedItem)
				}
			} else if (key.backspace || key.delete) {
				setSearch((prev) => prev.slice(0, -1))
			} else if (input && !key.ctrl && !key.meta && !key.escape) {
				setSearch((prev) => prev + input)
			}
		},
		{ isActive: isRawModeSupported && isActive },
	)

	return (
		<Box flexDirection="column">
			<Box>
				<Text color="gray">Search: </Text>
				<Text color="white">{search}</Text>
				<Text inverse> </Text>
			</Box>
			<Text> </Text>
			{showTopIndicator && <Text color="gray">... {visibleStart} more above</Text>}
			{visibleItems.map((item, i) => {
				const actualIndex = visibleStart + i
				const isSelected = actualIndex === index

				// Disabled items (section headers) render differently
				if (item.isDisabled) {
					return (
						<Box key={item.id}>
							<Text color="gray">
								{"  "}
								{item.label}
							</Text>
						</Box>
					)
				}

				return (
					<Box key={item.id}>
						<Text color={isSelected ? COLORS.primaryBlue : undefined}>
							{isSelected ? "❯ " : "  "}
							{item.label}
							{item.suffix && <Text color="gray"> {item.suffix}</Text>}
						</Text>
					</Box>
				)
			})}
			{showBottomIndicator && <Text color="gray">... {filteredItems.length - visibleStart - visibleCount} more below</Text>}
			{filteredItems.length === 0 && <Text color="gray">No matches for "{search}"</Text>}
		</Box>
	)
}

/**
 * Simple select list component - arrow keys to navigate, Enter to select
 * No search functionality, just a straightforward list picker
 */

import { Box, Text, useInput } from "ink"
// biome-ignore lint/correctness/noUnusedImports: React is needed for JSX transform (tsconfig uses jsx: react)
import React, { useState } from "react"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"

export interface SelectListItem {
	id: string
	label: string
	suffix?: string
}

interface SelectListProps<T extends SelectListItem> {
	items: T[]
	onSelect: (item: T) => void
	isActive?: boolean
}

export function SelectList<T extends SelectListItem>({ items, onSelect, isActive = true }: SelectListProps<T>) {
	const { isRawModeSupported } = useStdinContext()
	const [selectedIndex, setSelectedIndex] = useState(0)

	useInput(
		(_input, key) => {
			if (key.upArrow) {
				setSelectedIndex((i) => (i > 0 ? i - 1 : items.length - 1))
			} else if (key.downArrow) {
				setSelectedIndex((i) => (i < items.length - 1 ? i + 1 : 0))
			} else if (key.return) {
				const item = items[selectedIndex]
				if (item) {
					onSelect(item)
				}
			}
		},
		{ isActive: isActive && isRawModeSupported },
	)

	return (
		<Box flexDirection="column">
			{items.map((item, idx) => {
				const isSelected = idx === selectedIndex
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
		</Box>
	)
}

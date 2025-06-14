import { MarketplaceItem } from "@roo-code/types"

export interface GroupedItems {
	[type: string]: {
		type: string
		items: Array<{
			name: string
			description?: string
			metadata?: any
			path?: string
			matchInfo?: {
				matched: boolean
				matchReason?: Record<string, boolean>
			}
		}>
	}
}

/**
 * Groups package items by their type
 * @param items Array of items to group
 * @returns Object with items grouped by type
 */
export function groupItemsByType(items: MarketplaceItem[] = []): GroupedItems {
	if (!items?.length) {
		return {}
	}

	const groups: GroupedItems = {}

	for (const item of items) {
		if (!item.type) continue

		if (!groups[item.type]) {
			groups[item.type] = {
				type: item.type,
				items: [],
			}
		}

		groups[item.type].items.push({
			name: item.name || "Unnamed item",
			description: item.description,
			metadata: undefined,
			path: item.id, // Use id as path since MarketplaceItem doesn't have path
			matchInfo: undefined,
		})
	}

	return groups
}

/**
 * Gets a formatted string representation of an item
 * @param item The item to format
 * @returns Formatted string with name and description
 */
export function formatItemText(item: { name: string; description?: string }): string {
	if (!item.description) {
		return item.name
	}

	const maxLength = 100
	const result =
		item.name +
		" - " +
		(item.description.length > maxLength ? item.description.substring(0, maxLength) + "..." : item.description)

	return result
}

/**
 * Gets the total number of items across all groups
 * @param groups Grouped items object
 * @returns Total number of items
 */
export function getTotalItemCount(groups: GroupedItems): number {
	return Object.values(groups).reduce((total, group) => total + group.items.length, 0)
}

/**
 * Gets an array of unique types from the grouped items
 * @param groups Grouped items object
 * @returns Array of type strings
 */
export function getUniqueTypes(groups: GroupedItems): string[] {
	const types = Object.keys(groups)
	types.sort()
	return types
}

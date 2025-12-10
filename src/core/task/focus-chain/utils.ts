import { isCompletedFocusChainItem, isFocusChainItem } from "@shared/focus-chain-utils"

export interface TodoListCounts {
	totalItems: number
	completedItems: number
}

/**
 * Parses a focus chain list string and returns counts of total and completed items
 * @param todoList The focus chain list string to parse
 * @returns Object with totalItems and completedItems counts
 */
export function parseFocusChainListCounts(todoList: string): TodoListCounts {
	const lines = todoList.split("\n")
	let totalItems = 0
	let completedItems = 0

	for (const line of lines) {
		const trimmed = line.trim()
		if (isFocusChainItem(trimmed)) {
			totalItems++
			if (isCompletedFocusChainItem(trimmed)) {
				completedItems++
			}
		}
	}

	return { totalItems, completedItems }
}

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
		if (trimmed.startsWith("- [ ]") || trimmed.startsWith("- [x]") || trimmed.startsWith("- [X]")) {
			totalItems++
			if (trimmed.startsWith("- [x]") || trimmed.startsWith("- [X]")) {
				completedItems++
			}
		}
	}

	return { totalItems, completedItems }
}

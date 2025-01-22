/**
 * Inserts multiple groups of elements at specified indices in an array
 * @param original Array to insert into, split by lines
 * @param insertGroups Array of groups to insert, each with an index and elements to insert
 * @returns New array with all insertions applied
 */
export interface InsertGroup {
	index: number
	elements: string[]
}

export function insertGroups(original: string[], insertGroups: InsertGroup[]): string[] {
	// Sort groups by index to maintain order
	insertGroups.sort((a, b) => a.index - b.index)

	let result: string[] = []
	let lastIndex = 0

	insertGroups.forEach(({ index, elements }) => {
		// Add elements from original array up to insertion point
		result.push(...original.slice(lastIndex, index))
		// Add the group of elements
		result.push(...elements)
		lastIndex = index
	})

	// Add remaining elements from original array
	result.push(...original.slice(lastIndex))

	return result
}

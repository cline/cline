/**
 * Inserts multiple groups of elements at specified indices in an array
 * @param original Array to insert into, split by lines
 * @param insertGroups Array of groups to insert, each with an index and elements to insert.
 *                     If index is -1, the elements will be appended to the end of the array.
 * @returns New array with all insertions applied
 */
export interface InsertGroup {
	index: number
	elements: string[]
}

export function insertGroups(original: string[], insertGroups: InsertGroup[]): string[] {
	// Handle groups with index -1 separately and sort remaining groups by index
	const appendGroups = insertGroups.filter((group) => group.index === -1)
	const normalGroups = insertGroups.filter((group) => group.index !== -1).sort((a, b) => a.index - b.index)

	let result: string[] = []
	let lastIndex = 0

	normalGroups.forEach(({ index, elements }) => {
		// Add elements from original array up to insertion point
		result.push(...original.slice(lastIndex, index))
		// Add the group of elements
		result.push(...elements)
		lastIndex = index
	})

	// Add remaining elements from original array
	result.push(...original.slice(lastIndex))

	// Append elements from groups with index -1 at the end
	appendGroups.forEach(({ elements }) => {
		result.push(...elements)
	})

	return result
}

/**
 * Returns the index of the last element in the array where predicate is true, and -1
 * otherwise.
 * @param array The source array to search in
 * @param predicate find calls predicate once for each element of the array, in descending
 * order, until it finds one where predicate returns true. If such an element is found,
 * findLastIndex immediately returns that element index. Otherwise, findLastIndex returns -1.
 */
export function findLastIndex<T>(array: Array<T>, predicate: (value: T, index: number, obj: T[]) => boolean): number {
	let l = array.length
	while (l--) {
		if (predicate(array[l], l, array)) {
			return l
		}
	}
	return -1
}

export function findLast<T>(array: Array<T>, predicate: (value: T, index: number, obj: T[]) => boolean): T | undefined {
	const index = findLastIndex(array, predicate)
	return index === -1 ? undefined : array[index]
}

/**
 * Converts a partial or complete stringified array into an actual array.
 * Handles both complete JSON strings and incomplete array strings.
 * Splits on the specific tokens: ["  ", "  "]
 * @param arrayString A string representation of an array, which may be incomplete
 * @returns Array of strings parsed from the input
 */
export function parsePartialArrayString(arrayString: string): string[] {
	try {
		// Try parsing as complete JSON first
		return JSON.parse(arrayString)
	} catch {
		// If JSON parsing fails, handle as partial string
		const trimmed = arrayString.trim()
		if (!trimmed.startsWith('["')) {
			return []
		}

		// Remove leading ["
		let content = trimmed.slice(2)
		// Remove trailing "] if it exists
		content = content.replace(/"]$/, "")
		if (!content) {
			return []
		}

		// Split on ", " token and handle the parts
		return content
			.split('", "')
			.map((item) => item.trim())
			.filter(Boolean)
	}
}

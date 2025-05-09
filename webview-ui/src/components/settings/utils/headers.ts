/**
 * Converts an array of header key-value pairs to a Record object.
 *
 * @param headers Array of [key, value] tuples representing HTTP headers
 * @returns Record with trimmed keys and values
 */
export const convertHeadersToObject = (headers: [string, string][]): Record<string, string> => {
	const result: Record<string, string> = {}

	// Process each header tuple.
	for (const [key, value] of headers) {
		const trimmedKey = key.trim()

		// Skip empty keys.
		if (!trimmedKey) {
			continue
		}

		// For duplicates, the last one in the array wins.
		// This matches how HTTP headers work in general.
		result[trimmedKey] = value.trim()
	}

	return result
}

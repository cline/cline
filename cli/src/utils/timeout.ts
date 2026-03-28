/**
 * Wait for a condition to become truthy, with a timeout.
 * Uses Promise.race for clean timeout handling instead of polling.
 *
 * @param condition - Function that returns the value to check (truthy = done)
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param pollIntervalMs - How often to check the condition (default: 100ms)
 * @returns The truthy value if condition is met, or undefined if timeout
 */
export async function waitFor<T>(
	condition: () => T | undefined | null,
	timeoutMs: number,
	pollIntervalMs: number = 100,
): Promise<T | undefined> {
	// Check immediately first
	const immediate = condition()
	if (immediate) {
		return immediate
	}

	return new Promise((resolve) => {
		const intervalId = setInterval(() => {
			const result = condition()
			if (result) {
				clearInterval(intervalId)
				clearTimeout(timeoutId)
				resolve(result)
			}
		}, pollIntervalMs)

		const timeoutId = setTimeout(() => {
			clearInterval(intervalId)
			resolve(undefined)
		}, timeoutMs)
	})
}

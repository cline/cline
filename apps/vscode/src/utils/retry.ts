/**
 * TypeScript equivalent of the Go common.RetryOperation utility
 * Performs an operation with retry logic and timeout handling
 */
export async function retryOperation<T>(maxRetries: number, timeoutPerAttempt: number, operation: () => Promise<T>): Promise<T> {
	let lastError: Error | undefined

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			// Create a timeout promise
			let timeoutId: ReturnType<typeof setTimeout> | undefined
			const timeoutPromise = new Promise<never>((_, reject) => {
				timeoutId = setTimeout(() => reject(new Error("Operation timeout")), timeoutPerAttempt)
			})

			try {
				// Race the operation against timeout
				return await Promise.race([operation(), timeoutPromise])
			} finally {
				clearTimeout(timeoutId)
			}
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error))

			if (attempt < maxRetries) {
				// Brief delay before retry
				await new Promise((resolve) => setTimeout(resolve, 500))
			}
		}
	}

	throw new Error(`Operation failed after ${maxRetries} attempts: ${lastError?.message}`)
}

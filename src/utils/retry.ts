export interface RetryWithBackoffOptions {
	maxAttempts?: number
	baseDelayMs?: number
	maxDelayMs?: number
	multiplier?: number
	operationName?: string
	shouldRetry?: (error: unknown, attempt: number) => boolean
	onRetry?: (error: unknown, attempt: number, maxAttempts: number, delayMs: number) => void | Promise<void>
}

/**
 * Retries an async operation with exponential backoff.
 * Attempt 1 runs immediately. On failure, waits baseDelayMs * multiplier^(attempt-1) before each retry.
 */
export async function retryWithBackoff<T>(operation: () => Promise<T>, options: RetryWithBackoffOptions = {}): Promise<T> {
	const {
		maxAttempts = 3,
		baseDelayMs = 50,
		maxDelayMs = Number.POSITIVE_INFINITY,
		multiplier = 2,
		operationName = "Operation",
		shouldRetry = () => true,
		onRetry,
	} = options

	let lastError: unknown

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await operation()
		} catch (error) {
			lastError = error
			if (attempt === maxAttempts || !shouldRetry(error, attempt)) {
				break
			}
			const delayMs = Math.min(baseDelayMs * multiplier ** (attempt - 1), maxDelayMs)
			await onRetry?.(error, attempt, maxAttempts, delayMs)
			await new Promise((resolve) => setTimeout(resolve, delayMs))
		}
	}

	const message = lastError instanceof Error ? lastError.message : String(lastError)
	throw new Error(`${operationName} failed after ${maxAttempts} attempts: ${message}`)
}

/**
 * TypeScript equivalent of the Go common.RetryOperation utility
 * Performs an operation with retry logic and timeout handling
 */
export async function retryOperation<T>(maxRetries: number, timeoutPerAttempt: number, operation: () => Promise<T>): Promise<T> {
	let lastError: Error | undefined

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			// Create a timeout promise
			const timeoutPromise = new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("Operation timeout")), timeoutPerAttempt),
			)

			// Race the operation against timeout
			const result = await Promise.race([operation(), timeoutPromise])
			return result // Success - return result
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
